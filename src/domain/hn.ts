import { normalizeArticleUrl, sanitizeArticleUrl } from './url';
import type { ArticleCandidate } from './url';

const ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search';
const LOOKUP_TIMEOUT_MS = 5_000;

export interface HnDiscussion {
    id: string;
    title: string;
    articleUrl: string;
    comments: number;
    points: number;
    createdAt: number;
}

export type HnLookupResult =
    | { status: 'found'; primary: HnDiscussion; alternatives: HnDiscussion[] }
    | { status: 'not_found' }
    | { status: 'restricted' }
    | { status: 'error'; reason: 'invalid_response' | 'lookup_failed' };

interface AlgoliaHit {
    objectID: string;
    url: string;
    title?: string;
    num_comments?: number;
    points?: number;
    created_at_i?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isHnDiscussion(value: unknown): value is HnDiscussion {
    return isRecord(value)
        && typeof value.id === 'string'
        && isValidItemId(value.id)
        && typeof value.title === 'string'
        && typeof value.articleUrl === 'string'
        && isNonNegativeInteger(value.comments)
        && isNonNegativeInteger(value.points)
        && isNonNegativeInteger(value.createdAt);
}

export function isHnLookupResult(value: unknown): value is HnLookupResult {
    if (!isRecord(value)) {
        return false;
    }
    if (value.status === 'not_found' || value.status === 'restricted') {
        return true;
    }
    if (value.status === 'error') {
        return value.reason === 'invalid_response' || value.reason === 'lookup_failed';
    }
    return value.status === 'found'
        && isHnDiscussion(value.primary)
        && Array.isArray(value.alternatives)
        && value.alternatives.every(isHnDiscussion);
}

function parseHit(value: unknown): AlgoliaHit | null {
    if (!isRecord(value)
        || typeof value.objectID !== 'string'
        || !isValidItemId(value.objectID)
        || typeof value.url !== 'string'
        || (value.title !== undefined && typeof value.title !== 'string')
        || (value.num_comments !== undefined && !isNonNegativeInteger(value.num_comments))
        || (value.points !== undefined && !isNonNegativeInteger(value.points))
        || (value.created_at_i !== undefined && !isNonNegativeInteger(value.created_at_i))) {
        return null;
    }

    return {
        objectID: value.objectID,
        url: value.url,
        ...(value.title === undefined ? {} : { title: value.title }),
        ...(value.num_comments === undefined ? {} : { num_comments: value.num_comments }),
        ...(value.points === undefined ? {} : { points: value.points }),
        ...(value.created_at_i === undefined ? {} : { created_at_i: value.created_at_i }),
    };
}

function compareDiscussions(left: HnDiscussion, right: HnDiscussion): number {
    return right.comments - left.comments
        || right.points - left.points
        || right.createdAt - left.createdAt
        || Number(right.id) - Number(left.id);
}

function buildSearchUrl(candidate: ArticleCandidate): string {
    const sanitizedCandidateUrl = sanitizeArticleUrl(candidate.url);
    if (sanitizedCandidateUrl === null) {
        throw new TypeError('Invalid article candidate');
    }
    const url = new URL(ALGOLIA_ENDPOINT);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('restrictSearchableAttributes', 'url');
    url.searchParams.set('hitsPerPage', '20');
    url.searchParams.set('query', sanitizedCandidateUrl);
    return url.href;
}

async function fetchHits(
    candidate: ArticleCandidate,
    fetchFn: typeof fetch,
    signal: AbortSignal,
): Promise<AlgoliaHit[]> {
    const response = await fetchFn(buildSearchUrl(candidate), { signal });
    if (!response.ok) {
        throw new Error(`Lookup failed with HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.hits)) {
        throw new TypeError('Invalid Algolia response');
    }
    const hits: AlgoliaHit[] = [];
    for (const value of payload.hits) {
        const hit = parseHit(value);
        if (hit === null) {
            throw new TypeError('Invalid Algolia response');
        }
        hits.push(hit);
    }
    return hits;
}

function toDiscussion(hit: AlgoliaHit): HnDiscussion {
    return {
        id: hit.objectID,
        title: hit.title ?? 'Hacker News discussion',
        articleUrl: hit.url,
        comments: hit.num_comments ?? 0,
        points: hit.points ?? 0,
        createdAt: hit.created_at_i ?? 0,
    };
}

export async function lookupHnDiscussions(
    candidates: ArticleCandidate[],
    fetchFn: typeof fetch = fetch,
): Promise<HnLookupResult> {
    if (candidates.length === 0) {
        return { status: 'restricted' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    const results = await Promise.allSettled(
        candidates.map(async (candidate) => fetchHits(candidate, fetchFn, controller.signal)),
    );
    clearTimeout(timeout);

    const identities = new Set(candidates.map(({ identity }) => identity));
    const discussions = new Map<string, HnDiscussion>();
    let invalidResponse = false;
    let lookupFailure = false;

    for (const result of results) {
        if (result.status === 'rejected') {
            if (result.reason instanceof TypeError && result.reason.message === 'Invalid Algolia response') {
                invalidResponse = true;
            } else {
                lookupFailure = true;
            }
            continue;
        }

        for (const hit of result.value) {
            const identity = normalizeArticleUrl(hit.url);
            if (identity === null || !identities.has(identity)) {
                continue;
            }
            const discussion = toDiscussion(hit);
            const existing = discussions.get(discussion.id);
            if (existing === undefined || compareDiscussions(discussion, existing) < 0) {
                discussions.set(discussion.id, discussion);
            }
        }
    }

    const ranked = [...discussions.values()].sort(compareDiscussions);
    const primary = ranked[0];
    if (primary !== undefined) {
        return {
            status: 'found',
            primary,
            alternatives: ranked.slice(1),
        };
    }
    if (invalidResponse) {
        return { status: 'error', reason: 'invalid_response' };
    }
    if (lookupFailure) {
        return { status: 'error', reason: 'lookup_failed' };
    }
    return { status: 'not_found' };
}

export function isValidItemId(itemId: string): boolean {
    const value = Number(itemId);
    return /^\d+$/.test(itemId) && Number.isSafeInteger(value) && value > 0;
}

export function discussionUrl(itemId: string): string {
    if (!isValidItemId(itemId)) {
        throw new TypeError('Invalid Hacker News item ID');
    }
    return `https://news.ycombinator.com/item?id=${itemId}`;
}

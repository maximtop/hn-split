import * as v from 'valibot';

import { normalizeArticleUrl, sanitizeArticleUrl } from './url';
import type { ArticleCandidate } from './url';

const ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search';
const LOOKUP_TIMEOUT_MS = 5_000;
const DEFAULT_DISCUSSION_TITLE = 'Hacker News discussion';

const positiveItemIdSchema = v.pipe(
    v.string(),
    v.regex(/^\d+$/),
    v.check((itemId) => {
        const value = Number(itemId);
        return Number.isSafeInteger(value) && value > 0;
    }),
);

const nonNegativeIntegerSchema = v.pipe(
    v.number(),
    v.safeInteger(),
    v.minValue(0),
);

/** Describes one validated Hacker News discussion. */
export interface HnDiscussion {
    /** Contains the positive Hacker News item identifier. */
    id: string;
    /** Contains the discussion title. */
    title: string;
    /** Contains the article URL returned by Algolia. */
    articleUrl: string;
    /** Contains the non-negative comment count. */
    comments: number;
    /** Contains the non-negative point count. */
    points: number;
    /** Contains the non-negative Unix creation timestamp. */
    createdAt: number;
}

/** Represents every outcome of a Hacker News discussion lookup. */
export type HnLookupResult =
    | { status: 'found'; primary: HnDiscussion; alternatives: HnDiscussion[] }
    | { status: 'not_found' }
    | { status: 'restricted' }
    | { status: 'error'; reason: 'invalid_response' | 'lookup_failed' };

/** Validates discussion data crossing extension boundaries or cache storage. */
export const hnDiscussionSchema = v.object({
    id: positiveItemIdSchema,
    title: v.string(),
    articleUrl: v.string(),
    comments: nonNegativeIntegerSchema,
    points: nonNegativeIntegerSchema,
    createdAt: nonNegativeIntegerSchema,
});

/** Validates every supported Hacker News lookup result variant. */
export const hnLookupResultSchema = v.variant('status', [
    v.object({
        status: v.literal('found'),
        primary: hnDiscussionSchema,
        alternatives: v.array(hnDiscussionSchema),
    }),
    v.object({ status: v.literal('not_found') }),
    v.object({ status: v.literal('restricted') }),
    v.object({
        status: v.literal('error'),
        reason: v.union([v.literal('invalid_response'), v.literal('lookup_failed')]),
    }),
]);

const algoliaHitSchema = v.object({
    objectID: positiveItemIdSchema,
    url: v.string(),
    title: v.optional(v.string()),
    num_comments: v.optional(nonNegativeIntegerSchema),
    points: v.optional(nonNegativeIntegerSchema),
    created_at_i: v.optional(nonNegativeIntegerSchema),
});

const algoliaResponseSchema = v.object({
    hits: v.array(algoliaHitSchema),
});

type AlgoliaHit = v.InferOutput<typeof algoliaHitSchema>;

/** Determines whether an unknown value is a validated discussion. */
export function isHnDiscussion(value: unknown): value is HnDiscussion {
    return v.safeParse(hnDiscussionSchema, value).success;
}

/** Determines whether an unknown value is a validated lookup result. */
export function isHnLookupResult(value: unknown): value is HnLookupResult {
    return v.safeParse(hnLookupResultSchema, value).success;
}

/** Parses one Algolia hit without trusting the remote response shape. */
function parseHit(value: unknown): AlgoliaHit | null {
    const result = v.safeParse(algoliaHitSchema, value);
    return result.success ? result.output : null;
}

/** Orders discussions by engagement, recency, and stable item identifier. */
function compareDiscussions(left: HnDiscussion, right: HnDiscussion): number {
    return right.comments - left.comments
        || right.points - left.points
        || right.createdAt - left.createdAt
        || Number(right.id) - Number(left.id);
}

/** Builds a privacy-sanitized exact-URL Algolia search request. */
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

/** Fetches and validates all Algolia hits for one article candidate. */
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
    const parsed = v.safeParse(algoliaResponseSchema, payload);
    if (!parsed.success) {
        throw new TypeError('Invalid Algolia response');
    }
    const hits: AlgoliaHit[] = [];
    for (const value of parsed.output.hits) {
        const hit = parseHit(value);
        if (hit === null) {
            throw new TypeError('Invalid Algolia response');
        }
        hits.push(hit);
    }
    return hits;
}

/** Converts a validated Algolia hit into extension discussion data. */
function toDiscussion(hit: AlgoliaHit): HnDiscussion {
    return {
        id: hit.objectID,
        title: hit.title ?? DEFAULT_DISCUSSION_TITLE,
        articleUrl: hit.url,
        comments: hit.num_comments ?? 0,
        points: hit.points ?? 0,
        createdAt: hit.created_at_i ?? 0,
    };
}

/** Looks up and ranks Hacker News discussions for eligible article candidates. */
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

/** Determines whether a string is a positive safe Hacker News item identifier. */
export function isValidItemId(itemId: string): boolean {
    return v.safeParse(positiveItemIdSchema, itemId).success;
}

/** Builds the canonical Hacker News discussion URL for a validated item. */
export function discussionUrl(itemId: string): string {
    if (!isValidItemId(itemId)) {
        throw new TypeError('Invalid Hacker News item ID');
    }
    return `https://news.ycombinator.com/item?id=${itemId}`;
}

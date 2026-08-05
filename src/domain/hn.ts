import * as v from 'valibot';

import { normalizeArticleUrl, sanitizeArticleUrl } from './url';
import type { ArticleCandidate } from './url';

const ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search';
const LOOKUP_TIMEOUT_MS = 5_000;
const DEFAULT_DISCUSSION_TITLE = 'Hacker News discussion';

/**
 * Names every Hacker News lookup outcome.
 */
export const HN_LOOKUP_STATUS = {
    FOUND: 'found',
    NOT_FOUND: 'not_found',
    RESTRICTED: 'restricted',
    ERROR: 'error',
} as const;

/**
 * Names every classified Hacker News lookup failure.
 */
export const HN_LOOKUP_ERROR_REASON = {
    INVALID_RESPONSE: 'invalid_response',
    LOOKUP_FAILED: 'lookup_failed',
} as const;

class InvalidAlgoliaResponseError extends TypeError {}

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

/**
 * Validates discussion data crossing extension boundaries or cache storage.
 */
export const hnDiscussionSchema = v.object({
    id: positiveItemIdSchema,
    title: v.string(),
    articleUrl: v.string(),
    comments: nonNegativeIntegerSchema,
    points: nonNegativeIntegerSchema,
    createdAt: nonNegativeIntegerSchema,
});

/**
 * Describes one validated Hacker News discussion.
 */
export type HnDiscussion = v.InferOutput<typeof hnDiscussionSchema>;

/**
 * Validates every supported Hacker News lookup result variant.
 */
export const hnLookupResultSchema = v.variant('status', [
    v.object({
        status: v.literal(HN_LOOKUP_STATUS.FOUND),
        primary: hnDiscussionSchema,
        alternatives: v.array(hnDiscussionSchema),
    }),
    v.object({ status: v.literal(HN_LOOKUP_STATUS.NOT_FOUND) }),
    v.object({ status: v.literal(HN_LOOKUP_STATUS.RESTRICTED) }),
    v.object({
        status: v.literal(HN_LOOKUP_STATUS.ERROR),
        reason: v.union([
            v.literal(HN_LOOKUP_ERROR_REASON.INVALID_RESPONSE),
            v.literal(HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED),
        ]),
    }),
]);

/**
 * Represents every outcome of a Hacker News discussion lookup.
 */
export type HnLookupResult = v.InferOutput<typeof hnLookupResultSchema>;

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

/**
 * Determines whether an unknown value is a validated discussion.
 * @param value - The unknown runtime value to validate.
 */
export function isHnDiscussion(value: unknown): value is HnDiscussion {
    return v.safeParse(hnDiscussionSchema, value).success;
}

/**
 * Determines whether an unknown value is a validated lookup result.
 * @param value - The unknown runtime value to validate.
 */
export function isHnLookupResult(value: unknown): value is HnLookupResult {
    return v.safeParse(hnLookupResultSchema, value).success;
}

/**
 * Orders discussions by engagement, recency, and stable item identifier.
 * @param left - The first discussion to compare.
 * @param right - The second discussion to compare.
 */
function compareDiscussions(left: HnDiscussion, right: HnDiscussion): number {
    return right.comments - left.comments
        || right.points - left.points
        || right.createdAt - left.createdAt
        || Number(right.id) - Number(left.id);
}

/**
 * Builds a privacy-sanitized exact-URL Algolia search request.
 * @param candidate - The eligible article candidate to query.
 */
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

/**
 * Fetches and validates all Algolia hits for one article candidate.
 * @param candidate - The eligible article candidate to query.
 * @param fetchFn - The fetch implementation used for Algolia requests.
 * @param signal - The abort signal that cancels the request.
 */
async function fetchHits(
    candidate: ArticleCandidate,
    fetchFn: typeof fetch,
    signal: AbortSignal,
): Promise<AlgoliaHit[]> {
    const response = await fetchFn(buildSearchUrl(candidate), { signal });
    if (!response.ok) {
        throw new Error(`Lookup failed with HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error) {
        // A cancelled body read stays a lookup failure; only syntactically
        // malformed JSON is a service-response problem.
        if (signal.aborted) {
            throw error;
        }
        throw new InvalidAlgoliaResponseError('Malformed JSON payload', { cause: error });
    }
    const parsed = v.safeParse(algoliaResponseSchema, payload);
    if (!parsed.success) {
        throw new InvalidAlgoliaResponseError();
    }
    return parsed.output.hits;
}

/**
 * Converts a validated Algolia hit into extension discussion data.
 * @param hit - The validated Algolia hit to convert.
 */
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

/**
 * Looks up and ranks Hacker News discussions for eligible article candidates.
 * @param candidates - The eligible article candidates to query in preference order.
 * @param fetchFn - The fetch implementation used for Algolia requests.
 * @param signal - The optional caller signal that cancels the whole lookup early.
 */
export async function lookupHnDiscussions(
    candidates: ArticleCandidate[],
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<HnLookupResult> {
    if (candidates.length === 0) {
        return { status: HN_LOOKUP_STATUS.RESTRICTED };
    }

    const controller = new AbortController();
    const abortFromCaller = (): void => {
        controller.abort();
    };
    if (signal?.aborted === true) {
        controller.abort();
    } else {
        signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => {
        controller.abort();
    }, LOOKUP_TIMEOUT_MS);
    let results: Array<PromiseSettledResult<AlgoliaHit[]>>;
    try {
        results = await Promise.allSettled(
            candidates.map(async (candidate) => fetchHits(candidate, fetchFn, controller.signal)),
        );
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
    }

    const identities = new Set(candidates.map(({ identity }) => identity));
    const discussions = new Map<string, HnDiscussion>();
    let invalidResponse = false;
    let lookupFailure = false;

    for (const result of results) {
        if (result.status === 'rejected') {
            if (result.reason instanceof InvalidAlgoliaResponseError) {
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
            status: HN_LOOKUP_STATUS.FOUND,
            primary,
            alternatives: ranked.slice(1),
        };
    }
    if (invalidResponse) {
        return {
            status: HN_LOOKUP_STATUS.ERROR,
            reason: HN_LOOKUP_ERROR_REASON.INVALID_RESPONSE,
        };
    }
    if (lookupFailure) {
        return {
            status: HN_LOOKUP_STATUS.ERROR,
            reason: HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED,
        };
    }
    return { status: HN_LOOKUP_STATUS.NOT_FOUND };
}

/**
 * Determines whether a string is a positive safe Hacker News item identifier.
 * @param itemId - The candidate Hacker News item identifier.
 */
export function isValidItemId(itemId: string): boolean {
    return v.safeParse(positiveItemIdSchema, itemId).success;
}

/**
 * Names the Hacker News web origin that hosts every discussion page.
 */
export const HN_ORIGIN = 'https://news.ycombinator.com';

/**
 * Determines whether a URL belongs to the Hacker News web origin.
 * @param url - The untrusted URL value to inspect.
 */
export function isHnUrl(url: string): boolean {
    try {
        return new URL(url).origin === HN_ORIGIN;
    } catch {
        return false;
    }
}

/**
 * Builds the canonical Hacker News discussion URL for a validated item.
 * @param itemId - The validated Hacker News item identifier.
 */
export function discussionUrl(itemId: string): string {
    if (!isValidItemId(itemId)) {
        throw new TypeError('Invalid Hacker News item ID');
    }
    return `${HN_ORIGIN}/item?id=${itemId}`;
}

import { lookupWithCache } from '../browser/lookup-cache';
import { lookupHnDiscussions } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import { buildArticleCandidates } from '../domain/url';
import { cacheStorage } from './chrome-adapters';

/**
 * Contains a panel lookup outcome and its sanitized reusable identity.
 */
export interface PanelLookupResult {
    /**
     * Contains the verified Hacker News lookup outcome.
     */
    result: HnLookupResult;
    /**
     * Contains the sanitized primary article identity when one is eligible.
     */
    articleIdentity: string | null;
}

/**
 * Resolves one page context through the session-only lookup cache.
 * @param pageUrl - The active page URL to resolve.
 * @param canonicalHref - The page canonical URL when one is available.
 * @param signal - The optional abort signal that cancels a superseded lookup.
 */
export async function lookupArticle(pageUrl: string, canonicalHref: string | null, signal?: AbortSignal) {
    const candidates = buildArticleCandidates(pageUrl, canonicalHref);
    return lookupWithCache(
        candidates,
        cacheStorage,
        async () => lookupHnDiscussions(candidates, undefined, signal),
    );
}

/**
 * Resolves one side-panel page through the shared session lookup cache and
 * returns the already-sanitized identity used to construct that lookup.
 * @param pageUrl - The explicitly consented or opted-in page URL to resolve.
 * @param signal - The optional signal that cancels a superseded lookup.
 */
export async function lookupArticleForPanel(
    pageUrl: string,
    signal?: AbortSignal,
): Promise<PanelLookupResult> {
    const candidates = buildArticleCandidates(pageUrl, null);
    const result = await lookupWithCache(
        candidates,
        cacheStorage,
        async () => lookupHnDiscussions(candidates, undefined, signal),
    );
    return {
        result,
        articleIdentity: candidates[0]?.identity ?? null,
    };
}

import { lookupWithCache } from '../browser/lookup-cache';
import { lookupHnDiscussions } from '../domain/hn';
import { buildArticleCandidates } from '../domain/url';
import { cacheStorage } from './chrome-adapters';

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

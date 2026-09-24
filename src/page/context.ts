/**
 * @file Reads the page context (current and canonical URLs) from the inspected page. The popup injects the reader
 * into the active tab, so it must stay self-contained.
 */

import type { PageContext } from '../shared/messages';

export type { PageContext } from '../shared/messages';

/**
 * Reads the current and canonical URLs from the inspected page.
 */
export function readPageContext(): PageContext {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]');
    return {
        pageUrl: window.location.href,
        canonicalHref: canonical?.href ?? null,
    };
}

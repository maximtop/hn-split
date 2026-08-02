/** Describes the browser page URLs used for discussion lookup. */
export interface PageContext {
    /** Contains the page's current browser URL. */
    pageUrl: string;
    /** Contains the resolved canonical URL when the document declares one. */
    canonicalHref: string | null;
}

/** Reads the current and canonical URLs from the inspected page. */
export function readPageContext(): PageContext {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]');
    return {
        pageUrl: window.location.href,
        canonicalHref: canonical?.href ?? null,
    };
}

export interface PageContext {
    pageUrl: string;
    canonicalHref: string | null;
}

export function readPageContext(): PageContext {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]');
    return {
        pageUrl: window.location.href,
        canonicalHref: canonical?.href ?? null,
    };
}

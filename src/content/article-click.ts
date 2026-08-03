/**
 * Selects the story link inside a Hacker News title cell. The selector
 * requires a direct child so nested anchors, such as the `from?site=` link in
 * the site chip, never qualify.
 */
const STORY_LINK_SELECTOR = '.titleline > a';

/**
 * Selects the Hacker News story row whose `id` attribute carries the item
 * identifier.
 */
const STORY_ROW_SELECTOR = 'tr.athing';

/**
 * Names the only anchor target that keeps navigation in the current tab.
 */
const SELF_TARGET = '_self';

/**
 * Matches decimal Hacker News item identifiers.
 */
const ITEM_ID_PATTERN = /^\d+$/;

/**
 * Describes the click-event fields used to qualify a story-link click.
 */
export interface ArticleClickEventLike {
    /**
     * Indicates whether the browser dispatched the event for a real user
     * action.
     */
    isTrusted: boolean;
    /**
     * Contains the pressed pointer button, where zero is the primary button.
     */
    button: number;
    /**
     * Indicates whether the Meta key was held during the click.
     */
    metaKey: boolean;
    /**
     * Indicates whether the Control key was held during the click.
     */
    ctrlKey: boolean;
    /**
     * Indicates whether the Shift key was held during the click.
     */
    shiftKey: boolean;
    /**
     * Indicates whether the Alt key was held during the click.
     */
    altKey: boolean;
    /**
     * Indicates whether a page handler already canceled the default action.
     */
    defaultPrevented: boolean;
    /**
     * Contains the event target the click landed on.
     */
    target: unknown;
}

/**
 * Determines whether one decimal string is a plausible Hacker News item
 * identifier. The wire schema in `messages.ts` stays authoritative; this
 * local check only avoids sending obviously invalid messages.
 * @param id - The candidate row identifier to check.
 */
function isPlausibleItemId(id: string): boolean {
    if (!ITEM_ID_PATTERN.test(id)) {
        return false;
    }
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0;
}

/**
 * Decides whether one click qualifies as an unmodified primary activation of
 * an external story link, and resolves the story's item identifier from its
 * row. Returns null for every click the browser should handle untouched:
 * modified or non-primary clicks, canceled or synthetic events, downloads,
 * links targeting another browsing context, non-HTTP(S) URLs, and navigation
 * that stays on Hacker News itself (self posts, site chips, comment links).
 * Keyboard activation of a focused link dispatches an equivalent click event
 * and qualifies deliberately.
 * @param event - The observed click event.
 * @param pageOrigin - The origin of the observing document, passed in so the
 * check stays a pure function of its inputs under any test base URL.
 */
export function detectArticleClick(event: ArticleClickEventLike, pageOrigin: string): string | null {
    if (!event.isTrusted || event.button !== 0 || event.defaultPrevented) {
        return null;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return null;
    }
    if (!(event.target instanceof Element)) {
        return null;
    }
    const anchor = event.target.closest('a');
    if (anchor === null || !anchor.matches(STORY_LINK_SELECTOR)) {
        return null;
    }
    if (anchor.hasAttribute('download')) {
        return null;
    }
    const target = anchor.getAttribute('target');
    if (target !== null && target !== '' && target !== SELF_TARGET) {
        return null;
    }
    const row = anchor.closest(STORY_ROW_SELECTOR);
    if (row === null || !isPlausibleItemId(row.id)) {
        return null;
    }
    let url: URL;
    try {
        url = new URL(anchor.href);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
    }
    if (url.origin === pageOrigin) {
        return null;
    }
    return row.id;
}

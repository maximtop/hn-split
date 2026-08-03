const ARTICLE_CLICK_SCRIPT_ID = 'hn-article-click';

/**
 * Identifies the dynamically registered Hacker News article-click content
 * script: the registration ID and the emitted bundle file it injects.
 */
export const ARTICLE_CLICK_CONTENT_SCRIPT = {
    ID: ARTICLE_CLICK_SCRIPT_ID,
    FILE: `${ARTICLE_CLICK_SCRIPT_ID}.js`,
} as const;

/**
 * Names the fire-and-forget runtime message the article-click content script
 * sends when the user primary-clicks an external story link. This constant
 * lives outside `messages.ts` so the content-script bundle carries no
 * validation library; the wire schema stays authoritative in `messages.ts`.
 */
export const ARTICLE_CLICK_MESSAGE_TYPE = 'open_discussion_for_click';

/**
 * Names persistent and session storage keys owned by the extension.
 */
export const STORAGE_KEY = {
    AUTOMATIC_AVAILABILITY: 'automatic_availability',
    ARTICLE_CLICK_DISCUSSION: 'article_click_discussion',
} as const;

/**
 * Names prefixes for parameterized session-storage keys.
 */
export const SESSION_STORAGE_KEY_PREFIX = {
    DISCUSSION_TAB: 'discussion_tab:',
    SIDE_PANEL_DISCUSSION: 'side_panel_discussion:',
} as const;

/**
 * Builds the session-storage key holding one window's side panel selection.
 * @param windowId - The browser window whose panel selection the key stores.
 */
export function sidePanelContentKey(windowId: number): string {
    return `${SESSION_STORAGE_KEY_PREFIX.SIDE_PANEL_DISCUSSION}${windowId}`;
}

/**
 * Reads the window identifier back out of one side panel selection key.
 * @param key - The session-storage key to inspect.
 */
export function sidePanelContentWindowId(key: string): number | null {
    if (!key.startsWith(SESSION_STORAGE_KEY_PREFIX.SIDE_PANEL_DISCUSSION)) {
        return null;
    }
    const suffix = key.slice(SESSION_STORAGE_KEY_PREFIX.SIDE_PANEL_DISCUSSION.length);
    if (!/^\d+$/.test(suffix)) {
        return null;
    }
    const windowId = Number(suffix);
    return Number.isSafeInteger(windowId) ? windowId : null;
}

/**
 * Names persistent and session storage keys owned by the extension.
 */
export const STORAGE_KEY = {
    AUTOMATIC_AVAILABILITY: 'automatic_availability',
} as const;

/**
 * Names session-only storage keys owned by the extension.
 */
export const SESSION_STORAGE_KEY = {
    SIDE_PANEL_DISCUSSION: 'side_panel_discussion',
} as const;

/**
 * Names prefixes for parameterized session-storage keys.
 */
export const SESSION_STORAGE_KEY_PREFIX = {
    DISCUSSION_TAB: 'discussion_tab:',
} as const;

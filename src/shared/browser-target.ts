/**
 * Browser packages produced by the release build.
 */
export type BrowserTarget = 'chrome' | 'edge' | 'firefox';

declare const __TARGET_BROWSER__: BrowserTarget;

/**
 * Browser selected by the bundle, with Chrome as the unit-test default.
 */
export const CURRENT_BROWSER: BrowserTarget = typeof __TARGET_BROWSER__ === 'undefined'
    ? 'chrome'
    : __TARGET_BROWSER__;

/**
 * Whether the current package uses Firefox Sidebar instead of Chromium Side Panel.
 */
export const USES_FIREFOX_SIDEBAR = CURRENT_BROWSER === 'firefox';

/**
 * Article-click opening cannot preserve a Firefox sidebar user gesture.
 */
export const SUPPORTS_ARTICLE_CLICK = !USES_FIREFOX_SIDEBAR;

/**
 * Firefox-specific sidebar API exposed on Firefox's Chrome-compatible namespace.
 */
interface FirefoxSidebarChrome {
    /**
     * Browser sidebar action capability.
     */
    sidebarAction?: {
        /**
         * Opens the configured extension sidebar.
         */
        open: () => Promise<void>;
    };
}

/**
 * Opens the discussion surface synchronously inside the current user gesture.
 *
 * @param tabId Chromium tab whose window receives the side panel.
 * @returns Browser promise for the panel or sidebar open operation.
 */
export function openDiscussionSurface(tabId: number): Promise<void> {
    if (USES_FIREFOX_SIDEBAR) {
        const sidebarAction = (chrome as typeof chrome & FirefoxSidebarChrome).sidebarAction;
        if (sidebarAction === undefined) {
            return Promise.reject(new Error('Firefox Sidebar API is unavailable'));
        }
        return sidebarAction.open();
    }
    return chrome.sidePanel.open({ tabId });
}

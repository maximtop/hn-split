import { ensureOpenInSplitMenu } from '../browser/open-in-split-menu';
import { SidePanelContentRouter } from '../browser/side-panel-content-router';
import { OPEN_IN_SPLIT_MENU } from '../shared/context-menus';
import { logWarning } from '../shared/logger';
import type { SidePanelContent } from '../shared/side-panel-content';
import { lookupArticle } from './article-lookup';
import {
    contextMenuRegistry,
    getSidePanelContent,
    listSidePanelContent,
    openSidePanel,
    removeSidePanelContent,
    setSidePanelContent,
    tabs,
} from './chrome-adapters';

/**
 * Owns the per-window side panel selections for every entry point, so the
 * popup, the article-click flow, and the link context menu can never leave a
 * panel showing the result of a request the user has already replaced — and a
 * selection made in one window never touches what another window displays.
 */
const panelContent = new SidePanelContentRouter({
    openSidePanel,
    navigate: async (tabId, url) => {
        // The tab is the one the user right-clicked in, so it is already the
        // active tab of its window; keeping it active changes nothing there and
        // never pulls focus away from another tab.
        await tabs.update(tabId, { active: true, url });
    },
    readContent: getSidePanelContent,
    writeContent: setSidePanelContent,
    removeContent: removeSidePanelContent,
    listContent: listSidePanelContent,
    lookup: async (url, signal) => lookupArticle(url, null, signal),
    warn: logWarning,
});

/**
 * Handles one context-menu selection. Runs synchronously so the side panel can
 * open within the click's user gesture; everything else happens afterwards.
 * @param info - The Chrome click data reported for the menu selection.
 * @param tab - The tab the context menu was invoked in, when Chrome reports one.
 */
export function handleOpenInSplitClick(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab | undefined,
): void {
    const tabId = tab?.id;
    const windowId = tab?.windowId;
    if (info.menuItemId !== OPEN_IN_SPLIT_MENU.ID
        || info.linkUrl === undefined
        || tabId === undefined
        || windowId === undefined) {
        return;
    }
    panelContent.openLink(info.linkUrl, tabId, windowId);
}

/**
 * Displays one already known discussion in one window's side panel.
 * @param itemId - The validated Hacker News item identifier to display.
 * @param windowId - The browser window whose panel shows the discussion.
 */
export async function selectSidePanelDiscussion(itemId: string, windowId: number): Promise<SidePanelContent> {
    return panelContent.showDiscussion(itemId, windowId);
}

/**
 * Publishes the link menu item. Chrome drops menu items on extension updates
 * and browser restarts, so every worker start republishes them.
 */
export async function reconcileOpenInSplitMenu(): Promise<void> {
    await ensureOpenInSplitMenu(contextMenuRegistry);
}

/**
 * Resolves lookup states left behind by a worker that stopped mid-request.
 */
export async function normalizeSidePanelContent(): Promise<void> {
    await panelContent.normalizeStartupContent();
}

/**
 * Discards one closed window's selection and its in-flight work.
 * @param windowId - The browser window that was closed.
 */
export async function forgetSidePanelWindow(windowId: number): Promise<void> {
    await panelContent.forgetWindow(windowId);
}

import { ensureOpenInSplitMenu } from '../browser/open-in-split-menu';
import { SidePanelContentManager } from '../browser/side-panel-content-manager';
import { OPEN_IN_SPLIT_MENU } from '../shared/context-menus';
import { logWarning } from '../shared/logger';
import type { SidePanelContent } from '../shared/side-panel-content';
import { lookupArticle } from './article-lookup';
import {
    contextMenuRegistry,
    getSidePanelContent,
    openSidePanel,
    setSidePanelContent,
    tabs,
} from './chrome-adapters';

/**
 * Owns the single side panel selection for every entry point, so the popup,
 * the article-click flow, and the link context menu can never leave the panel
 * showing the result of a request the user has already replaced.
 */
const panelContent = new SidePanelContentManager({
    openSidePanel,
    navigate: async (tabId, url) => {
        // The tab is the one the user right-clicked in, so it is already the
        // active tab of its window; keeping it active changes nothing there and
        // never pulls focus away from another tab.
        await tabs.update(tabId, { active: true, url });
    },
    readContent: getSidePanelContent,
    writeContent: setSidePanelContent,
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
    if (info.menuItemId !== OPEN_IN_SPLIT_MENU.ID || info.linkUrl === undefined || tabId === undefined) {
        return;
    }
    panelContent.openLink(info.linkUrl, tabId);
}

/**
 * Displays one already known discussion in the side panel.
 * @param itemId - The validated Hacker News item identifier to display.
 */
export async function selectSidePanelDiscussion(itemId: string): Promise<SidePanelContent> {
    return panelContent.showDiscussion(itemId);
}

/**
 * Publishes the link menu item. Chrome drops menu items on extension updates
 * and browser restarts, so every worker start republishes them.
 */
export async function reconcileOpenInSplitMenu(): Promise<void> {
    await ensureOpenInSplitMenu(contextMenuRegistry);
}

/**
 * Resolves a lookup state left behind by a worker that stopped mid-request.
 */
export async function normalizeSidePanelContent(): Promise<void> {
    await panelContent.normalizeStartupContent();
}

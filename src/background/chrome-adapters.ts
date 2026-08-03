import type { ContentScriptRegistry } from '../browser/article-click-registration';
import type { AvailabilityBadge } from '../browser/availability-badge';
import type { CacheCollectionStorage, CacheStorage } from '../browser/lookup-cache';
import type { SessionStore, TabClient, TabSummary } from '../browser/open-discussion';
import type { OpenInSplitMenuRegistry } from '../browser/open-in-split-menu';
import { HN_ORIGIN } from '../domain/hn';
import { ARTICLE_CLICK_CONTENT_SCRIPT } from '../shared/content-scripts';
import { isSidePanelContent } from '../shared/side-panel-content';
import type { SidePanelContent } from '../shared/side-panel-content';
import { SESSION_STORAGE_KEY, SESSION_STORAGE_KEY_PREFIX, STORAGE_KEY } from '../shared/storage-keys';

/**
 * Converts a Chrome tab into the fields used by discussion placement.
 * @param tab - The Chrome tab to convert.
 */
function toTabSummary(tab: chrome.tabs.Tab): TabSummary {
    return {
        ...(tab.id === undefined ? {} : { id: tab.id }),
        index: tab.index,
        windowId: tab.windowId,
        ...(tab.splitViewId === undefined ? {} : { splitViewId: tab.splitViewId }),
    };
}

/**
 * Builds the session-storage key for one article-to-discussion association.
 * @param articleTabId - The source article tab identifier.
 */
function discussionTabKey(articleTabId: number): string {
    return `${SESSION_STORAGE_KEY_PREFIX.DISCUSSION_TAB}${articleTabId}`;
}

/**
 * Adapts the Chrome tabs API to discussion-tab operations.
 */
export const tabs: TabClient = {
    async get(tabId) {
        return toTabSummary(await chrome.tabs.get(tabId));
    },
    async create(properties) {
        return toTabSummary(await chrome.tabs.create(properties));
    },
    async update(tabId, properties) {
        const tab = await chrome.tabs.update(tabId, properties);
        if (tab === undefined) {
            throw new Error('Chrome did not return the updated discussion tab');
        }
        return toTabSummary(tab);
    },
};

/**
 * Stores article-to-discussion associations in session-only storage.
 */
export const sessionStore: SessionStore = {
    async get(articleTabId) {
        const key = discussionTabKey(articleTabId);
        const stored = await chrome.storage.session.get(key);
        return typeof stored[key] === 'number' ? stored[key] : undefined;
    },
    async set(articleTabId, discussionTabId) {
        await chrome.storage.session.set({ [discussionTabKey(articleTabId)]: discussionTabId });
    },
    async remove(articleTabId) {
        await chrome.storage.session.remove(discussionTabKey(articleTabId));
    },
};

/**
 * Adapts session storage to individual lookup-cache operations.
 */
export const cacheStorage: CacheStorage = {
    async get(key) {
        return (await chrome.storage.session.get(key))[key];
    },
    async set(key, value) {
        await chrome.storage.session.set({ [key]: value });
    },
    async remove(key) {
        await chrome.storage.session.remove(key);
    },
};

/**
 * Adapts session storage to selective lookup-cache cleanup.
 */
export const cacheCollectionStorage: CacheCollectionStorage = {
    async getAll() {
        return chrome.storage.session.get(null);
    },
    async remove(keys) {
        await chrome.storage.session.remove(keys);
    },
};

/**
 * Reads what the side panel should display in this browser session. Anything
 * the current model does not recognize reads as an empty panel.
 */
export async function getSidePanelContent(): Promise<SidePanelContent | null> {
    const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY.SIDE_PANEL_DISCUSSION);
    const content: unknown = stored[SESSION_STORAGE_KEY.SIDE_PANEL_DISCUSSION];
    return isSidePanelContent(content) ? content : null;
}

/**
 * Records what the side panel should display.
 * @param content - The validated panel content to display.
 */
export async function setSidePanelContent(content: SidePanelContent): Promise<void> {
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY.SIDE_PANEL_DISCUSSION]: content });
}

/**
 * Reads the authoritative automatic-availability setting.
 */
export async function getAutomaticAvailabilityEnabled(): Promise<boolean> {
    const stored = await chrome.storage.local.get(STORAGE_KEY.AUTOMATIC_AVAILABILITY);
    return stored[STORAGE_KEY.AUTOMATIC_AVAILABILITY] === true;
}

/**
 * Persists the authoritative automatic-availability setting.
 * @param enabled - Whether automatic availability should be enabled.
 */
export async function setAutomaticAvailabilityEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY.AUTOMATIC_AVAILABILITY]: enabled });
}

/**
 * Reads the authoritative article-click setting.
 */
export async function getArticleClickDiscussionEnabled(): Promise<boolean> {
    const stored = await chrome.storage.local.get(STORAGE_KEY.ARTICLE_CLICK_DISCUSSION);
    return stored[STORAGE_KEY.ARTICLE_CLICK_DISCUSSION] === true;
}

/**
 * Persists the authoritative article-click setting.
 * @param enabled - Whether article clicks should open the discussion panel.
 */
export async function setArticleClickDiscussionEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY.ARTICLE_CLICK_DISCUSSION]: enabled });
}

/**
 * Adapts the Chrome scripting API to the article-click content script, which
 * exists only while the article-click setting is enabled. Registration is
 * limited to top-level Hacker News documents, so the discussion frame inside
 * the side panel never receives the script.
 */
export const contentScriptRegistry: ContentScriptRegistry = {
    async isRegistered() {
        const scripts = await chrome.scripting.getRegisteredContentScripts({
            ids: [ARTICLE_CLICK_CONTENT_SCRIPT.ID],
        });
        return scripts.length > 0;
    },
    async register() {
        await chrome.scripting.registerContentScripts([{
            id: ARTICLE_CLICK_CONTENT_SCRIPT.ID,
            js: [ARTICLE_CLICK_CONTENT_SCRIPT.FILE],
            matches: [`${HN_ORIGIN}/*`],
            runAt: 'document_end',
            allFrames: false,
            persistAcrossSessions: true,
        }]);
    },
    async unregister() {
        await chrome.scripting.unregisterContentScripts({
            ids: [ARTICLE_CLICK_CONTENT_SCRIPT.ID],
        });
    },
};

/**
 * Adapts the Chrome context-menu API to the link action. Unlike most of the
 * Chrome APIs used here, `create` reports failures through `runtime.lastError`
 * inside its callback instead of rejecting, so the failure is surfaced here.
 */
export const contextMenuRegistry: OpenInSplitMenuRegistry = {
    async removeAll() {
        await chrome.contextMenus.removeAll();
    },
    async create(properties) {
        await new Promise<void>((resolve, reject) => {
            chrome.contextMenus.create({
                id: properties.id,
                title: properties.title,
                contexts: properties.contexts as [chrome.contextMenus.ContextType, ...chrome.contextMenus.ContextType[]],
                targetUrlPatterns: [...properties.targetUrlPatterns],
            }, () => {
                const failure = chrome.runtime.lastError;
                if (failure === undefined) {
                    resolve();
                    return;
                }
                reject(new Error(failure.message));
            });
        });
    },
};

/**
 * Opens the extension side panel in the window of one tab. Chrome accepts the
 * call only while the originating user gesture is valid, so callers must not
 * await anything before invoking this.
 * @param tabId - The browser tab whose window shows the panel.
 */
export async function openSidePanel(tabId: number): Promise<void> {
    await chrome.sidePanel.open({ tabId });
}

/**
 * Applies localized browser-action badge state to one live tab.
 * @param tabId - The Chrome tab that receives the badge state.
 * @param badge - The localized badge state to apply.
 */
export async function applyAvailabilityBadge(tabId: number, badge: AvailabilityBadge): Promise<void> {
    try {
        await chrome.action.setBadgeText({ tabId, text: badge.text });
        if (badge.color !== undefined) {
            await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
        }
        await chrome.action.setTitle({ tabId, title: badge.title });
    } catch (error) {
        try {
            await chrome.tabs.get(tabId);
        } catch {
            return;
        }
        throw error;
    }
}

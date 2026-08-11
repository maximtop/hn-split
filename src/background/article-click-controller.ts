import { respondToArticleClick } from '../browser/article-click-open';
import { ensureArticleClickRegistration } from '../browser/article-click-registration';
import { applySettingTransaction, createSettingQueue } from '../browser/setting-lifecycle';
import { HN_ORIGIN } from '../domain/hn';
import { logFollowWarning } from '../shared/logger';
import type { ArticleClickMessage } from '../shared/messages';
import {
    contentScriptRegistry,
    getArticleClickDiscussionEnabled,
    openSidePanel,
    setArticleClickDiscussionEnabled,
} from './chrome-adapters';
import {
    cancelSidePanelExpectedNavigation,
    cancelSidePanelExplicitOperation,
    prepareSidePanelExplicitOperation,
    reserveSidePanelExpectedNavigation,
    reserveSidePanelExplicitOperation,
    selectSidePanelDiscussion,
} from './side-panel-content-controller';

/**
 * Mirrors the persisted article-click setting so the message listener can
 * consult it synchronously: `chrome.sidePanel.open` accepts the click's user
 * gesture only before the first await. The value stays undefined until the
 * first read or transaction completes, and resets to undefined after a failed
 * transaction so the next click re-reads storage instead of trusting a
 * possibly stale mirror.
 */
let cachedEnabled: boolean | undefined;

const applyArticleClickChange = createSettingQueue(async (enabled) => {
    try {
        await applySettingTransaction(enabled, {
            getEnabled: getArticleClickDiscussionEnabled,
            setEnabled: setArticleClickDiscussionEnabled,
            enable: async () => ensureArticleClickRegistration(true, contentScriptRegistry),
            disable: async () => ensureArticleClickRegistration(false, contentScriptRegistry),
        });
        cachedEnabled = enabled;
    } catch (error) {
        cachedEnabled = undefined;
        throw error;
    }
});

/**
 * Applies one serialized article-click setting transaction.
 * @param enabled - Whether article clicks should open the discussion panel.
 */
export async function setArticleClickSetting(enabled: boolean): Promise<boolean> {
    await applyArticleClickChange(enabled);
    return enabled;
}

/**
 * Converges the content-script registration with the persisted setting.
 * Chrome drops dynamically registered scripts on extension updates, and a
 * crash can separate the persisted value from the registration, so every
 * worker start replays the stored value through the same serialized queue.
 */
export async function reconcileArticleClickRegistration(): Promise<void> {
    const enabled = await getArticleClickDiscussionEnabled();
    await applyArticleClickChange(enabled);
}

/**
 * Handles one validated story-click message from the content script. Runs
 * synchronously so the side panel can open within the click's user gesture.
 * @param message - The validated article-click message.
 * @param sender - The Chrome runtime sender reported for the message.
 */
export function handleArticleClickMessage(
    message: ArticleClickMessage,
    sender: chrome.runtime.MessageSender,
): void {
    respondToArticleClick(
        { itemId: message.itemId, articleUrl: message.articleUrl },
        {
            ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id }),
            ...(sender.tab?.windowId === undefined ? {} : { windowId: sender.tab.windowId }),
            ...(sender.origin === undefined ? {} : { origin: sender.origin }),
        },
        HN_ORIGIN,
        {
            cachedEnabled: () => cachedEnabled,
            readEnabled: getArticleClickDiscussionEnabled,
            reserveExpectedNavigation: (tabId, windowId, articleUrl) => (
                reserveSidePanelExpectedNavigation(windowId, tabId, articleUrl)
            ),
            reserveExplicitOperation: (tabId, windowId) => (
                reserveSidePanelExplicitOperation(windowId, tabId)
            ),
            prepareExplicitOperation: async (reservation, windowId) => (
                prepareSidePanelExplicitOperation(windowId, reservation)
            ),
            cancelExpectedNavigation: (reservation, windowId) => {
                cancelSidePanelExpectedNavigation(windowId, reservation);
            },
            cancelExplicitOperation: (reservation, windowId, resynchronize) => {
                cancelSidePanelExplicitOperation(
                    windowId,
                    reservation,
                    resynchronize,
                );
            },
            openSidePanel,
            // Routed through the shared owner so a clicked story supersedes any
            // link lookup still in flight in the same window instead of racing it.
            setSelection: async (selection) => {
                await selectSidePanelDiscussion(selection);
            },
            warn: logFollowWarning,
        },
    );
}

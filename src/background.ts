import {
    handleArticleClickMessage,
    reconcileArticleClickRegistration,
} from './background/article-click-controller';
import {
    forgetAutomaticAvailabilityTab,
    reportsAutomaticAvailabilityNavigation,
    updateAutomaticAvailability,
} from './background/automatic-availability-controller';
import { sessionStore } from './background/chrome-adapters';
import { handleRequest } from './background/request-handler';
import {
    connectSidePanelWindow,
    disconnectSidePanelWindow,
    forgetSidePanelTab,
    forgetSidePanelWindow,
    handleOpenInSplitClick,
    handleSidePanelTabActivated,
    handleSidePanelTabAttached,
    handleSidePanelTabReplaced,
    handleSidePanelTabUpdated,
    normalizeSidePanelContent,
    reconcileOpenInSplitMenu,
    sidePanelWindows,
} from './background/side-panel-content-controller';
import { SidePanelFraming } from './background/side-panel-framing';
import { SidePanelPortController } from './background/side-panel-port-controller';
import {
    FOLLOW_DIAGNOSTIC_CODE,
    logFollowWarning,
    logWarning,
} from './shared/logger';
import {
    isArticleClickMessage,
    isBackgroundRequest,
} from './shared/messages';

const SIDE_PANEL_DOCUMENT_PATH = 'side-panel.html';

const sidePanelFraming = new SidePanelFraming(chrome.declarativeNetRequest);
const sidePanelPorts = new SidePanelPortController({
    framing: sidePanelFraming,
    sidePanelExtensionId: chrome.runtime.id,
    sidePanelDocumentUrl: chrome.runtime.getURL(SIDE_PANEL_DOCUMENT_PATH),
    windows: sidePanelWindows,
    connectWindow: connectSidePanelWindow,
    disconnectWindow: disconnectSidePanelWindow,
    warn: logFollowWarning,
});

// A rule left behind by a crashed worker would outlive the panel that asked
// for it, so the exception is cleared on every worker start.
void sidePanelFraming.reset().catch((error: unknown) => {
    logWarning('clearing the side panel framing exception failed.', error);
});

// Chrome drops dynamically registered content scripts on extension updates,
// so every worker start replays the persisted article-click setting.
void reconcileArticleClickRegistration().catch((error: unknown) => {
    logWarning('reconciling the article-click content script failed.', error);
});

// Menu items are dropped on extension updates and browser restarts too.
void reconcileOpenInSplitMenu().catch((error: unknown) => {
    logWarning('publishing the link context menu failed.', error);
});

// A worker that stopped mid-lookup would leave the panel waiting for a result
// that can no longer arrive, so that state is resolved on every worker start.
void normalizeSidePanelContent().catch((error: unknown) => {
    logWarning('normalizing the side panel content failed.', error);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    // Handled synchronously for the same reason as the article-click message
    // below: chrome.sidePanel.open accepts the click's user gesture only
    // before the first await.
    handleOpenInSplitClick(info, tab);
});

chrome.runtime.onConnect.addListener((port) => {
    sidePanelPorts.accept(port);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isArticleClickMessage(message)) {
        // Handled synchronously and without a response: chrome.sidePanel.open
        // accepts the click's user gesture only before the first await, and
        // the sending page is usually navigating away already.
        handleArticleClickMessage(message, sender);
        return false;
    }
    if (!isBackgroundRequest(message)) {
        return false;
    }
    void handleRequest(message).then(sendResponse);
    return true;
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    void handleSidePanelTabActivated(activeInfo)
        .then((projection) => {
            if (projection !== null) {
                sidePanelPorts.recoverWindow(activeInfo.windowId);
            }
        })
        .catch(() => {
            logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
                tabId: activeInfo.tabId,
                windowId: activeInfo.windowId,
            });
        });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (reportsAutomaticAvailabilityNavigation(changeInfo)) {
        void updateAutomaticAvailability(tabId).catch((error: unknown) => {
            // Local diagnostic only; the navigated URL itself is never logged.
            logWarning('automatic availability update failed.', error);
        });
    }
    if (changeInfo.url === undefined && changeInfo.status !== 'complete') {
        return;
    }
    void handleSidePanelTabUpdated(tabId, tab.windowId, tab.active, {
        ...(changeInfo.status === 'loading' || changeInfo.status === 'complete'
            ? { status: changeInfo.status }
            : {}),
        ...(changeInfo.url === undefined ? {} : { url: changeInfo.url }),
    })
        .then((authoritative) => {
            if (authoritative) {
                sidePanelPorts.recoverWindow(tab.windowId);
            }
        })
        .catch(() => {
            logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
                tabId,
                windowId: tab.windowId,
            });
        });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    forgetAutomaticAvailabilityTab(tabId);
    void forgetSidePanelTab(tabId, removeInfo.windowId).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
            tabId,
            windowId: removeInfo.windowId,
        });
    });
    void sessionStore.remove(tabId).catch(() => undefined);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    void handleSidePanelTabReplaced(addedTabId, removedTabId).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
            tabId: addedTabId,
            relatedTabId: removedTabId,
        });
    });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
    void forgetSidePanelTab(tabId, detachInfo.oldWindowId).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
            tabId,
            windowId: detachInfo.oldWindowId,
        });
    });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    void handleSidePanelTabAttached(tabId, attachInfo).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, {
            tabId,
            windowId: attachInfo.newWindowId,
        });
    });
});

chrome.windows.onRemoved.addListener((windowId) => {
    // A closed window's panel selection has no surface left to show it.
    void forgetSidePanelWindow(windowId).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, { windowId });
    });
});

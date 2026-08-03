import {
    handleArticleClickMessage,
    reconcileArticleClickRegistration,
} from './background/article-click-controller';
import {
    forgetAutomaticAvailabilityTab,
    updateAutomaticAvailability,
} from './background/automatic-availability-controller';
import { sessionStore } from './background/chrome-adapters';
import { handleRequest } from './background/request-handler';
import {
    handleOpenInSplitClick,
    normalizeSidePanelContent,
    reconcileOpenInSplitMenu,
} from './background/side-panel-content-controller';
import { SidePanelFraming } from './background/side-panel-framing';
import { logWarning } from './shared/logger';
import {
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    isArticleClickMessage,
    isBackgroundRequest,
} from './shared/messages';

const TAB_UPDATE_STATUS = {
    COMPLETE: 'complete',
} as const;

const sidePanelFraming = new SidePanelFraming(chrome.declarativeNetRequest);

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
    if (port.name !== SIDE_PANEL_PORT) {
        return;
    }
    // The exception exists only while a panel holds this port open: the panel
    // waits for the ready signal before framing, and Chrome disconnects the
    // port as soon as the panel closes.
    let connected = true;
    port.onDisconnect.addListener(() => {
        connected = false;
        void sidePanelFraming.release().catch((error: unknown) => {
            logWarning('removing the side panel framing exception failed.', error);
        });
    });
    void sidePanelFraming.acquire()
        .then(() => {
            // The panel can close before the rule lands, and posting into a
            // closed port throws.
            if (connected) {
                port.postMessage({ type: SIDE_PANEL_READY });
            }
        })
        .catch((error: unknown) => {
            logWarning('installing the side panel framing exception failed.', error);
        });
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? (changeInfo.status === TAB_UPDATE_STATUS.COMPLETE ? tab.url : undefined);
    if (url === undefined) {
        return;
    }
    void updateAutomaticAvailability(tabId, url).catch((error: unknown) => {
        // Local diagnostic only; the navigated URL itself is never logged.
        logWarning('automatic availability update failed.', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    forgetAutomaticAvailabilityTab(tabId);
    void sessionStore.remove(tabId).catch(() => undefined);
});

import {
    forgetAutomaticAvailabilityTab,
    updateAutomaticAvailability,
} from './background/automatic-availability-controller';
import { sessionStore } from './background/chrome-adapters';
import { handleRequest } from './background/request-handler';
import { isBackgroundRequest } from './shared/messages';

const TAB_UPDATE_STATUS = {
    COMPLETE: 'complete',
} as const;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
        console.warn('HN Split: automatic availability update failed.', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    forgetAutomaticAvailabilityTab(tabId);
    void sessionStore.remove(tabId).catch(() => undefined);
});

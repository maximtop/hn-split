import { applySettingTransaction } from '../browser/setting-lifecycle';
import {
    SIDE_PANEL_FOLLOW_CONTINUATION_KIND,
} from '../browser/side-panel-content-manager';
import type {
    SidePanelFollowActivationReservation,
    SidePanelFollowAuthorityReservation,
} from '../browser/side-panel-content-router';
import type { SidePanelContent } from '../shared/side-panel-content';
import {
    getActiveTab,
    getBrowserTab,
    getSidePanelFollowEnabled,
    setSidePanelFollowEnabled,
} from './chrome-adapters';
import {
    cancelSidePanelFollowActivation,
    captureSidePanelFollowAuthority,
    continueSidePanelFollowActivation,
    disableAutomaticSidePanelFollow,
    reserveSidePanelFollowActivationIfCurrent,
    restoreOrCheckSidePanelTab,
    sidePanelWindows,
    synchronizeSidePanelFollowSettingWithStatus,
} from './side-panel-content-controller';

const ACTIVE_TAB_UNAVAILABLE_MESSAGE = 'Active side panel tab is unavailable';
const PANEL_WINDOW_DISCONNECTED_MESSAGE = 'Side panel window is not connected';
const FOLLOW_SYNCHRONIZATION_FAILED_MESSAGE = 'Side panel synchronization produced no content';
const LIVE_WINDOW_SYNCHRONIZATION_FAILED_MESSAGE = 'Unable to synchronize live side panel windows';

const FOLLOW_INITIATING_BOUNDARY_KIND = {
    ACTIVATION: 'activation',
    AUTHORITY: 'authority',
} as const;

/**
 * Carries an action-time tab successfully reserved before the setting queue.
 */
interface FollowActivationInitiatingBoundary {
    /**
     * Identifies a successfully reserved action-time activation.
     */
    kind: typeof FOLLOW_INITIATING_BOUNDARY_KIND.ACTIVATION;
    /**
     * Contains the exact manager reservation to continue after persistence.
     */
    reservation: SidePanelFollowActivationReservation;
}

/**
 * Carries an action-time read crossed by a newer manager authority boundary.
 */
interface FollowAuthorityInitiatingBoundary {
    /**
     * Identifies an authority crossing that must be classified after persistence.
     */
    kind: typeof FOLLOW_INITIATING_BOUNDARY_KIND.AUTHORITY;
    /**
     * Contains the authority captured before the trusted active-tab read.
     */
    authority: SidePanelFollowAuthorityReservation;
    /**
     * Contains the tab returned by that crossed active-tab read.
     */
    tabId: number;
}

/**
 * Describes the initiating window's exact pre-queue authority boundary.
 */
type FollowInitiatingBoundary =
    | FollowActivationInitiatingBoundary
    | FollowAuthorityInitiatingBoundary;

/**
 * Describes one serialized follow preference mutation and its optional trusted
 * one-click initiating authority boundary.
 */
interface FollowSettingChange {
    /**
     * Contains the requested persistent preference value.
     */
    enabled: boolean;
    /**
     * Contains the action-time boundary for a one-click enable command.
     */
    initiatingBoundary: FollowInitiatingBoundary | null;
    /**
     * Captures each live manager's authority before this change enters the queue.
     */
    authorities: SidePanelFollowAuthorityReservation[];
}

let followQueue: Promise<void> = Promise.resolve();

/**
 * Returns a valid tab identifier owned by the expected browser window.
 * @param tab - The browser tab read at a trusted boundary.
 * @param windowId - The expected owning window.
 */
function ownedTabId(tab: chrome.tabs.Tab | null, windowId: number): number | null {
    const tabId = tab?.id;
    return tab !== null
        && tabId !== undefined
        && Number.isSafeInteger(tabId)
        && tabId >= 0
        && tab.windowId === windowId
        ? tabId
        : null;
}

/**
 * Reads a tab URL only when a consented manager invokes the lazy callback and
 * the captured tab still belongs to the expected window.
 * @param windowId - The expected owning window.
 * @param tabId - The captured browser tab.
 */
async function readCurrentTabUrl(
    windowId: number,
    tabId: number,
): Promise<string | undefined> {
    const tab = await getBrowserTab(tabId);
    return ownedTabId(tab, windowId) === tabId ? tab?.url : undefined;
}

/**
 * Waits for every live-window effect before allowing a failed transaction to
 * roll back, preventing late sibling work from publishing after rollback.
 * @param operations - The live-window effects started by one transaction.
 */
async function settleLiveWindowOperations(operations: Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(operations);
    const failures: unknown[] = [];
    for (const result of results) {
        if (result.status === 'rejected') {
            failures.push(result.reason as unknown);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, LIVE_WINDOW_SYNCHRONIZATION_FAILED_MESSAGE);
    }
}

/**
 * Synchronizes the genuinely current tab for one still-live panel window as a
 * serialized setting effect.
 * @param initialAuthority - The request-time authority for the live panel window.
 */
async function synchronizeActiveSidePanelTab(
    initialAuthority: SidePanelFollowAuthorityReservation,
): Promise<SidePanelContent | null> {
    let authority = initialAuthority;
    while (sidePanelWindows.has(authority.windowId)) {
        const tab = await getActiveTab(authority.windowId);
        if (!sidePanelWindows.has(authority.windowId)) {
            return null;
        }
        const tabId = ownedTabId(tab, authority.windowId);
        if (tabId === null) {
            return null;
        }
        const result = await synchronizeSidePanelFollowSettingWithStatus(
            authority,
            tabId,
            async () => readCurrentTabUrl(authority.windowId, tabId),
        );
        if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED) {
            return result.projection.content;
        }
        if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED) {
            return result.projection?.content ?? null;
        }
        authority = captureSidePanelFollowAuthority(authority.windowId);
    }
    return null;
}

/**
 * Continues only the exact captured activation, yielding to a newer explicit
 * or manual operation and retrying only after a genuine tab activation.
 * @param reservation - The captured window, tab, and manager token.
 */
async function continueCapturedFollowActivation(
    reservation: SidePanelFollowActivationReservation,
): Promise<SidePanelContent | null> {
    if (!sidePanelWindows.has(reservation.windowId)) {
        cancelSidePanelFollowActivation(reservation);
        return null;
    }
    const tab = await getBrowserTab(reservation.tabId);
    if (!sidePanelWindows.has(reservation.windowId)) {
        cancelSidePanelFollowActivation(reservation);
        return null;
    }
    if (ownedTabId(tab, reservation.windowId) !== reservation.tabId) {
        cancelSidePanelFollowActivation(reservation);
        return null;
    }
    if (tab?.active !== true) {
        cancelSidePanelFollowActivation(reservation);
        return synchronizeActiveSidePanelTab(
            captureSidePanelFollowAuthority(reservation.windowId),
        );
    }
    const result = await continueSidePanelFollowActivation(
        reservation,
        async () => readCurrentTabUrl(reservation.windowId, reservation.tabId),
    );
    if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED) {
        return result.projection.content;
    }
    if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED) {
        return synchronizeActiveSidePanelTab(
            captureSidePanelFollowAuthority(reservation.windowId),
        );
    }
    return result.projection?.content ?? null;
}

/**
 * Classifies an action-time read crossed by newer manager authority. A genuine
 * tab activation falls forward to the current tab, while explicit or manual
 * authority yields its projection without reserving over it.
 * @param boundary - The stale authority and tab observed by the trusted read.
 */
async function continueCrossedFollowAuthority(
    boundary: FollowAuthorityInitiatingBoundary,
): Promise<SidePanelContent | null> {
    if (!sidePanelWindows.has(boundary.authority.windowId)) {
        return null;
    }
    const result = await synchronizeSidePanelFollowSettingWithStatus(
        boundary.authority,
        boundary.tabId,
        async () => readCurrentTabUrl(boundary.authority.windowId, boundary.tabId),
    );
    if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED) {
        return synchronizeActiveSidePanelTab(
            captureSidePanelFollowAuthority(boundary.authority.windowId),
        );
    }
    return result.projection?.content ?? null;
}

/**
 * Continues the initiating window according to the exact authority boundary
 * captured before it entered the serialized setting queue.
 * @param boundary - The reserved activation or crossed manager authority.
 */
async function continueInitiatingBoundary(
    boundary: FollowInitiatingBoundary,
): Promise<SidePanelContent | null> {
    return boundary.kind === FOLLOW_INITIATING_BOUNDARY_KIND.ACTIVATION
        ? continueCapturedFollowActivation(boundary.reservation)
        : continueCrossedFollowAuthority(boundary);
}

/**
 * Returns the browser window owned by one initiating boundary.
 * @param boundary - The reserved activation or crossed manager authority.
 */
function initiatingWindowId(boundary: FollowInitiatingBoundary): number {
    return boundary.kind === FOLLOW_INITIATING_BOUNDARY_KIND.ACTIVATION
        ? boundary.reservation.windowId
        : boundary.authority.windowId;
}

/**
 * Applies one setting transaction in FIFO order and returns the initiating
 * panel's resulting content when the mutation came from a one-click command.
 * @param change - The requested preference and optional action-time capture.
 */
function enqueueFollowChange(
    change: FollowSettingChange,
): Promise<SidePanelContent | null> {
    let content: SidePanelContent | null = null;
    const apply = async (): Promise<void> => {
        await applySettingTransaction(change.enabled, {
            getEnabled: getSidePanelFollowEnabled,
            setEnabled: setSidePanelFollowEnabled,
            enable: async () => {
                const operations = sidePanelWindows.windowIds().map(async (windowId) => {
                    if (change.initiatingBoundary !== null
                        && windowId === initiatingWindowId(change.initiatingBoundary)) {
                        content = await continueInitiatingBoundary(change.initiatingBoundary);
                        return;
                    }
                    const authority = change.authorities.find(
                        (candidate) => candidate.windowId === windowId,
                    ) ?? captureSidePanelFollowAuthority(windowId);
                    await synchronizeActiveSidePanelTab(authority);
                });
                await settleLiveWindowOperations(operations);
                if (change.initiatingBoundary !== null && content === null) {
                    throw new Error(FOLLOW_SYNCHRONIZATION_FAILED_MESSAGE);
                }
            },
            disable: disableAutomaticSidePanelFollow,
        });
    };
    const operation = followQueue.then(apply, apply);
    followQueue = operation.catch(() => undefined);
    return operation.then(() => content);
}

/**
 * Applies one serialized persistent side-panel-follow setting transaction.
 * @param enabled - Whether live panels may follow active tabs automatically.
 */
export async function setSidePanelFollowSetting(enabled: boolean): Promise<boolean> {
    const authorities = enabled
        ? sidePanelWindows.windowIds().map(captureSidePanelFollowAuthority)
        : [];
    await enqueueFollowChange({ enabled, initiatingBoundary: null, authorities });
    return getSidePanelFollowEnabled();
}

/**
 * Performs one manual check of the tab active at trusted background handling
 * time without reading or changing any automatic preference.
 * @param windowId - The live panel window issuing the command.
 */
export async function checkActiveSidePanelTab(windowId: number): Promise<SidePanelContent> {
    while (sidePanelWindows.has(windowId)) {
        const authority = captureSidePanelFollowAuthority(windowId);
        const tab = await getActiveTab(windowId);
        if (!sidePanelWindows.has(windowId)) {
            throw new Error(PANEL_WINDOW_DISCONNECTED_MESSAGE);
        }
        const tabId = ownedTabId(tab, windowId);
        if (tabId === null) {
            throw new Error(ACTIVE_TAB_UNAVAILABLE_MESSAGE);
        }
        if (captureSidePanelFollowAuthority(windowId).token !== authority.token) {
            const result = await synchronizeSidePanelFollowSettingWithStatus(
                authority,
                tabId,
                async () => readCurrentTabUrl(windowId, tabId),
            );
            if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED) {
                continue;
            }
            if (result.projection === null) {
                throw new Error(FOLLOW_SYNCHRONIZATION_FAILED_MESSAGE);
            }
            return result.projection.content;
        }
        const projection = await restoreOrCheckSidePanelTab(
            windowId,
            tabId,
            async () => readCurrentTabUrl(windowId, tabId),
        );
        return projection.content;
    }
    throw new Error(PANEL_WINDOW_DISCONNECTED_MESSAGE);
}

/**
 * Captures the trusted active tab before the setting queue, enables following,
 * and synchronizes that exact capture as one command.
 * @param windowId - The live panel window issuing the command.
 */
export async function enableSidePanelFollow(windowId: number): Promise<SidePanelContent> {
    let initiatingBoundary: FollowInitiatingBoundary | null = null;
    while (sidePanelWindows.has(windowId) && initiatingBoundary === null) {
        const authority = captureSidePanelFollowAuthority(windowId);
        const tab = await getActiveTab(windowId);
        if (!sidePanelWindows.has(windowId)) {
            throw new Error(PANEL_WINDOW_DISCONNECTED_MESSAGE);
        }
        const tabId = ownedTabId(tab, windowId);
        if (tabId === null) {
            throw new Error(ACTIVE_TAB_UNAVAILABLE_MESSAGE);
        }
        const reservation = reserveSidePanelFollowActivationIfCurrent(authority, tabId);
        initiatingBoundary = reservation === null
            ? {
                    kind: FOLLOW_INITIATING_BOUNDARY_KIND.AUTHORITY,
                    authority,
                    tabId,
                }
            : {
                    kind: FOLLOW_INITIATING_BOUNDARY_KIND.ACTIVATION,
                    reservation,
                };
    }
    if (initiatingBoundary === null) {
        throw new Error(PANEL_WINDOW_DISCONNECTED_MESSAGE);
    }
    const authorities = sidePanelWindows.windowIds().map(captureSidePanelFollowAuthority);
    try {
        const content = await enqueueFollowChange({
            enabled: true,
            initiatingBoundary,
            authorities,
        });
        if (content === null) {
            throw new Error(FOLLOW_SYNCHRONIZATION_FAILED_MESSAGE);
        }
        return content;
    } catch (error) {
        if (initiatingBoundary.kind === FOLLOW_INITIATING_BOUNDARY_KIND.ACTIVATION) {
            cancelSidePanelFollowActivation(initiatingBoundary.reservation);
        }
        throw error;
    }
}

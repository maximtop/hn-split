import { ensureOpenInSplitMenu } from '../browser/open-in-split-menu';
import type {
    ExpectedNavigationReservation,
    ExplicitOperationReservation,
    ShowDiscussionOptions,
    SidePanelFollowContinuation,
} from '../browser/side-panel-content-manager';
import { SidePanelContentRouter } from '../browser/side-panel-content-router';
import type {
    SidePanelFollowActivationReservation,
    SidePanelFollowAuthorityReservation,
    SidePanelRecoveryReservation,
} from '../browser/side-panel-content-router';
import { SidePanelWindowRegistry } from '../browser/side-panel-window-registry';
import { normalizeArticleUrl } from '../domain/url';
import { OPEN_IN_SPLIT_MENU } from '../shared/context-menus';
import {
    FOLLOW_DIAGNOSTIC_CODE,
    logFollowWarning,
} from '../shared/logger';
import type { SidePanelContent } from '../shared/side-panel-content';
import type {
    SidePanelProjection,
    SidePanelReadyStamp,
} from '../shared/side-panel-projection';
import { SIDE_PANEL_TARGET } from '../shared/messages';
import { lookupArticleForPanel } from './article-lookup';
import {
    contextMenuRegistry,
    getActiveTab,
    getBrowserTab,
    getSidePanelFollowEnabled,
    getSidePanelContent,
    listSidePanelContent,
    openSidePanel,
    removeSidePanelContent,
    setSidePanelContent,
    sidePanelAssociations,
    tabs,
} from './chrome-adapters';

const ACTIVE_TAB_UNAVAILABLE_MESSAGE = 'Active side panel tab is unavailable';

/**
 * Defines the tab-aware router operations driven by browser lifecycle events.
 */
export interface SidePanelLifecycleContentOwner {
    /**
     * Initializes one newly connected panel window.
     * @param windowId - The browser window whose panel connected.
     * @param tabId - The tab active in that window.
     * @param readUrl - Consent-gated lazy URL acquisition.
     */
    connect(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection>;
    /**
     * Synchronizes one active tab in a live panel window.
     * @param windowId - The browser window whose panel is live.
     * @param tabId - The newly active tab.
     * @param readUrl - Consent-gated lazy URL acquisition.
     */
    activate(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection>;
    /**
     * Continues one manager-owned recovery after an asynchronous active-tab read.
     * @param reservation - The opaque recovery and its owning browser window.
     * @param tabId - The tab active when the browser read completed.
     * @param readUrl - Consent-gated lazy URL acquisition.
     */
    recover(
        reservation: SidePanelRecoveryReservation,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null>;
    /**
     * Processes one tab URL update through association and follow consent.
     * @param windowId - The current or former tab window.
     * @param tabId - The tab that navigated.
     * @param reportedUrl - The browser-reported URL.
     * @param active - Whether the tab is active.
     * @param panelLive - Whether its window has a live panel.
     */
    navigation(
        windowId: number,
        tabId: number,
        reportedUrl: string | undefined,
        active: boolean,
        panelLive: boolean,
    ): Promise<SidePanelProjection | null>;
    /**
     * Resumes a pending consented synchronization after status completion.
     * @param windowId - The live panel window.
     * @param tabId - The still-active pending tab.
     * @param readUrl - Lazy authoritative URL acquisition.
     */
    resumePendingUrl(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null>;
    /**
     * Removes one invalid tab association and its in-flight manager state.
     * @param tabId - The invalid browser tab.
     * @param windowId - Its known former owner when available.
     */
    forgetTab(tabId: number, windowId?: number): Promise<void>;
    /**
     * Cancels unfinished work after a window loses its last panel port.
     * @param windowId - The disconnected browser window.
     */
    disconnectWindow(windowId: number): Promise<void>;
    /**
     * Removes all manager and projection state for a closed browser window.
     * @param windowId - The closed browser window.
     */
    forgetWindow(windowId: number): Promise<void>;
}

/**
 * Defines browser reads, live-window state, and router operations used by the
 * testable side-panel lifecycle coordinator.
 */
export interface SidePanelLifecycleControllerDependencies {
    /**
     * Reports whether a browser window currently has a live panel port.
     */
    windows: Pick<SidePanelWindowRegistry, 'has'>;
    /**
     * Owns all per-window panel projections and tab associations.
     */
    content: SidePanelLifecycleContentOwner;
    /**
     * Reads the tab active in one browser window.
     * @param windowId - The browser window to query.
     */
    getActiveTab(windowId: number): Promise<chrome.tabs.Tab | null>;
    /**
     * Reads one tab for ownership validation and consent-gated URL access.
     * @param tabId - The browser tab to read.
     */
    getTab(tabId: number): Promise<chrome.tabs.Tab | null>;
}

/**
 * Carries the URL/status subset relevant to side-panel synchronization.
 */
export interface SidePanelTabUpdate {
    /**
     * Contains the browser loading status when Chrome reports it.
     */
    status?: 'loading' | 'complete';
    /**
     * Contains the browser-reported navigation URL when Chrome reports it.
     */
    url?: string;
}

/**
 * Coordinates active-tab, navigation, replacement, attachment, and cleanup
 * lifecycle boundaries without opening a panel or reading a URL without consent.
 */
export class SidePanelLifecycleController {
    /**
     * Creates the lifecycle coordinator.
     * @param dependencies - Live-window, browser-read, and content-owner boundaries.
     */
    constructor(private readonly dependencies: SidePanelLifecycleControllerDependencies) {}

    /**
     * Initializes one framed panel from the tab active at handling time.
     * @param windowId - The browser window whose panel connected.
     */
    async connectWindow(windowId: number): Promise<SidePanelReadyStamp> {
        const tab = await this.dependencies.getActiveTab(windowId);
        const tabId = this.ownedTabId(tab, windowId);
        if (tabId === null) {
            throw new Error(ACTIVE_TAB_UNAVAILABLE_MESSAGE);
        }
        const projection = await this.dependencies.content.connect(
            windowId,
            tabId,
            async () => this.readCurrentTabUrl(windowId, tabId),
        );
        return {
            tabId: projection.content.tabId,
            projectionRevision: projection.revision,
        };
    }

    /**
     * Synchronizes a newly active tab only while its window has a live panel.
     * @param tabId - The newly active browser tab.
     * @param windowId - The browser window that owns the tab.
     */
    async activateTab(tabId: number, windowId: number): Promise<SidePanelProjection | null> {
        if (!this.dependencies.windows.has(windowId)) {
            return null;
        }
        return this.dependencies.content.activate(
            windowId,
            tabId,
            async () => this.readCurrentTabUrl(windowId, tabId),
        );
    }

    /**
     * Routes one tab update through invalidation and optional pending completion.
     * @param tabId - The updated browser tab.
     * @param windowId - The tab's current browser window.
     * @param active - Whether the tab is active.
     * @param change - Relevant URL and loading-status fields.
     * @returns Whether the update authoritatively represented an active tab in
     * a live panel window and completed without failure.
     */
    async updateTab(
        tabId: number,
        windowId: number,
        active: boolean,
        change: Readonly<SidePanelTabUpdate>,
    ): Promise<boolean> {
        const panelLive = this.dependencies.windows.has(windowId);
        if (change.url !== undefined) {
            await this.dependencies.content.navigation(
                windowId,
                tabId,
                change.url,
                active,
                panelLive,
            );
        }
        if (change.status === 'complete' && panelLive && active) {
            await this.dependencies.content.resumePendingUrl(
                windowId,
                tabId,
                async () => this.readCurrentTabUrl(windowId, tabId),
            );
        }
        return panelLive && active;
    }

    /**
     * Removes one closed, replaced, or detached tab.
     * @param tabId - The invalid browser tab.
     * @param windowId - Its known former owner when available.
     */
    async forgetTab(tabId: number, windowId?: number): Promise<void> {
        if (windowId === undefined) {
            await this.dependencies.content.forgetTab(tabId);
            return;
        }
        await this.dependencies.content.forgetTab(tabId, windowId);
    }

    /**
     * Cleans up a replaced tab before inspecting and synchronizing its successor.
     * @param addedTabId - The replacement tab created by Chrome.
     * @param removedTabId - The invalidated prior tab.
     */
    async replaceTab(addedTabId: number, removedTabId: number): Promise<void> {
        await this.forgetTab(removedTabId);
        const tab = await this.dependencies.getTab(addedTabId);
        if (tab === null) {
            return;
        }
        const { windowId } = tab;
        if (this.ownedTabId(tab, windowId) !== addedTabId
            || !tab.active) {
            return;
        }
        await this.activateTab(addedTabId, windowId);
    }

    /**
     * Validates an attached tab's destination before synchronizing it when active.
     * @param tabId - The tab attached to another window.
     * @param windowId - The destination browser window.
     */
    async attachTab(tabId: number, windowId: number): Promise<void> {
        const tab = await this.dependencies.getTab(tabId);
        if (this.ownedTabId(tab, windowId) !== tabId || !tab?.active) {
            return;
        }
        await this.activateTab(tabId, windowId);
    }

    /**
     * Re-runs the ordinary live-panel gate for the tab active at recovery time.
     * @param reservation - The manager-owned recovery and its browser window.
     */
    async resynchronizeWindow(reservation: SidePanelRecoveryReservation): Promise<void> {
        const { windowId, signal } = reservation;
        if (signal.aborted || !this.dependencies.windows.has(windowId)) {
            return;
        }
        const tab = await this.dependencies.getActiveTab(windowId);
        if (!this.dependencies.windows.has(windowId)) {
            return;
        }
        const tabId = this.ownedTabId(tab, windowId);
        if (tabId === null) {
            return;
        }
        await this.dependencies.content.recover(
            reservation,
            tabId,
            async () => this.readCurrentTabUrl(windowId, tabId),
        );
    }

    /**
     * Cancels unfinished state when a window loses its final live panel port.
     * @param windowId - The disconnected browser window.
     */
    async disconnectWindow(windowId: number): Promise<void> {
        await this.dependencies.content.disconnectWindow(windowId);
    }

    /**
     * Removes all projection and manager state for a closed window.
     * @param windowId - The closed browser window.
     */
    async removeWindow(windowId: number): Promise<void> {
        await this.dependencies.content.forgetWindow(windowId);
    }

    /**
     * Reads a tab URL only after the content owner invokes the consent-gated
     * callback, and only while the tab still belongs to the expected window.
     * @param windowId - The expected owning browser window.
     * @param tabId - The tab whose URL is requested.
     */
    private async readCurrentTabUrl(
        windowId: number,
        tabId: number,
    ): Promise<string | undefined> {
        const tab = await this.dependencies.getTab(tabId);
        return this.ownedTabId(tab, windowId) === tabId ? tab?.url : undefined;
    }

    /**
     * Returns a tab identifier only when the browser read still belongs to the
     * expected window.
     * @param tab - The browser tab read at the lifecycle boundary.
     * @param windowId - The expected owning window.
     */
    private ownedTabId(tab: chrome.tabs.Tab | null, windowId: number): number | null {
        const tabId = tab?.id;
        return tab !== null
            && tabId !== undefined
            && Number.isSafeInteger(tabId)
            && tabId >= 0
            && tab.windowId === windowId
            ? tabId
            : null;
    }
}

/**
 * Tracks every live side-panel document by browser window.
 */
export const sidePanelWindows = new SidePanelWindowRegistry();

/**
 * Owns the per-window side panel selections for every entry point, so the
 * popup, the article-click flow, and the link context menu can never leave a
 * panel showing the result of a request the user has already replaced — and a
 * selection made in one window never touches what another window displays.
 */
const panelContent = new SidePanelContentRouter({
    associations: sidePanelAssociations,
    openSidePanel,
    navigate: async (tabId, url) => {
        // The tab is the one the user right-clicked in, so it is already the
        // active tab of its window; keeping it active changes nothing there and
        // never pulls focus away from another tab.
        await tabs.update(tabId, { active: true, url });
    },
    readProjection: getSidePanelContent,
    writeProjection: setSidePanelContent,
    removeProjection: removeSidePanelContent,
    listProjections: listSidePanelContent,
    isFollowEnabled: getSidePanelFollowEnabled,
    lookup: async (url, signal) => lookupArticleForPanel(url, signal),
    getTabWindow: async (tabId) => {
        try {
            return (await tabs.get(tabId)).windowId;
        } catch {
            return null;
        }
    },
    normalizeArticleUrl,
    discardFrame: (windowId, tabId) => {
        sidePanelWindows.discardTab(windowId, tabId);
    },
    target: (windowId, tabId, minimumProjectionRevision) => {
        sidePanelWindows.broadcast(windowId, {
            type: SIDE_PANEL_TARGET,
            tabId,
            minimumProjectionRevision,
        });
    },
    resynchronize: async (reservation) => resynchronizeSidePanelWindow(reservation),
    warn: logFollowWarning,
});

const sidePanelLifecycle = new SidePanelLifecycleController({
    windows: sidePanelWindows,
    content: panelContent,
    getActiveTab,
    getTab: getBrowserTab,
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
    void panelContent.openLink(windowId, tabId, info.linkUrl).catch(() => {
        logFollowWarning(FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED, { tabId, windowId });
    });
}

/**
 * Reserves one exact expected navigation for an article-click action.
 * @param windowId - The panel window owning the source tab.
 * @param tabId - The source Hacker News tab.
 * @param articleUrl - The exact clicked article target.
 */
export function reserveSidePanelExpectedNavigation(
    windowId: number,
    tabId: number,
    articleUrl: string,
): ExpectedNavigationReservation {
    return panelContent.reserveExpectedNavigation(windowId, tabId, articleUrl);
}

/**
 * Cancels one exact expected navigation.
 * @param windowId - The reservation's panel window.
 * @param reservation - The exact expected navigation to cancel.
 */
export function cancelSidePanelExpectedNavigation(
    windowId: number,
    reservation: ExpectedNavigationReservation,
): void {
    panelContent.cancelExpectedNavigation(windowId, reservation);
}

/**
 * Reserves explicit projection precedence before an action opens the panel.
 * @param windowId - The panel window owning the action.
 * @param tabId - The explicitly targeted tab.
 */
export function reserveSidePanelExplicitOperation(
    windowId: number,
    tabId: number,
): ExplicitOperationReservation {
    return panelContent.reserveExplicitOperation(windowId, tabId);
}

/**
 * Starts pending readiness for one exact explicit reservation.
 * @param windowId - The reservation's panel window.
 * @param reservation - The exact explicit operation.
 */
export async function prepareSidePanelExplicitOperation(
    windowId: number,
    reservation: ExplicitOperationReservation,
): Promise<unknown> {
    return panelContent.prepareExplicitOperation(windowId, reservation);
}

/**
 * Cancels one exact explicit reservation.
 * @param windowId - The reservation's panel window.
 * @param reservation - The exact explicit operation.
 * @param resynchronize - Whether a reserved live target must be restored.
 */
export function cancelSidePanelExplicitOperation(
    windowId: number,
    reservation: ExplicitOperationReservation,
    resynchronize: boolean,
): void {
    panelContent.cancelExplicitOperation(windowId, reservation, resynchronize);
}

/**
 * Captures one action-time tab in its opaque per-window manager without
 * acquiring a URL or changing visible panel state.
 * @param windowId - The live panel window issuing the command.
 * @param tabId - The tab active at the trusted request boundary.
 */
export function reserveSidePanelFollowActivation(
    windowId: number,
    tabId: number,
): SidePanelFollowActivationReservation {
    return panelContent.reserveFollowActivation(windowId, tabId);
}

/**
 * Captures one live window's manager authority before an asynchronous active-tab read.
 * @param windowId - The panel window whose authority is captured.
 */
export function captureSidePanelFollowAuthority(
    windowId: number,
): SidePanelFollowAuthorityReservation {
    return panelContent.captureFollowAuthority(windowId);
}

/**
 * Captures an action-time tab only when its preceding asynchronous read did not
 * cross a newer trusted manager boundary.
 * @param authority - The authority captured before the active-tab read.
 * @param tabId - The tab returned by that read.
 */
export function reserveSidePanelFollowActivationIfCurrent(
    authority: SidePanelFollowAuthorityReservation,
    tabId: number,
): SidePanelFollowActivationReservation | null {
    return panelContent.reserveFollowActivationIfCurrent(authority, tabId);
}

/**
 * Cancels one exact queued follow capture after its setting transaction fails.
 * @param reservation - The opaque capture to cancel.
 */
export function cancelSidePanelFollowActivation(
    reservation: SidePanelFollowActivationReservation,
): void {
    panelContent.cancelFollowActivation(reservation);
}

/**
 * Continues one captured activation after consent is persisted and reports
 * whether a newer real activation or explicit/manual operation won instead.
 * @param reservation - The exact opaque capture to continue.
 * @param readUrl - Lazy ownership-checked URL acquisition.
 */
export async function continueSidePanelFollowActivation(
    reservation: SidePanelFollowActivationReservation,
    readUrl: () => Promise<string | undefined>,
): Promise<SidePanelFollowContinuation> {
    return panelContent.continueFollowActivationWithStatus(reservation, readUrl);
}

/**
 * Runs one manual check through the shared per-window owner.
 * @param windowId - The live panel window issuing the command.
 * @param tabId - The tab active at the trusted request boundary.
 * @param readUrl - Lazy URL acquisition authorized by the manual action.
 */
export async function restoreOrCheckSidePanelTab(
    windowId: number,
    tabId: number,
    readUrl: () => Promise<string | undefined>,
): Promise<SidePanelProjection> {
    return panelContent.restoreOrCheck(windowId, tabId, readUrl);
}

/**
 * Synchronizes one live window as the effect of a serialized follow setting.
 * @param windowId - The live panel window to synchronize.
 * @param tabId - The tab active in that window.
 * @param readUrl - Lazy ownership-checked URL acquisition.
 */
export async function synchronizeSidePanelFollowSetting(
    windowId: number,
    tabId: number,
    readUrl: () => Promise<string | undefined>,
): Promise<SidePanelProjection> {
    return panelContent.synchronizeFollowSetting(windowId, tabId, readUrl);
}

/**
 * Applies one queued setting effect only while its request-time manager
 * authority remains current.
 * @param authority - The opaque request-time manager authority.
 * @param tabId - The active tab to synchronize.
 * @param readUrl - Lazy ownership-checked URL acquisition.
 */
export async function synchronizeSidePanelFollowSettingWithStatus(
    authority: SidePanelFollowAuthorityReservation,
    tabId: number,
    readUrl: () => Promise<string | undefined>,
): Promise<SidePanelFollowContinuation> {
    return panelContent.synchronizeFollowSettingWithStatus(authority, tabId, readUrl);
}

/**
 * Cancels unfinished automatic work across every instantiated window manager.
 */
export async function disableAutomaticSidePanelFollow(): Promise<void> {
    await panelContent.disableAutomatic();
}

/**
 * Displays one already known discussion in one window's side panel.
 * @param options - The window, tab, item, source page, and optional reservation.
 */
export async function selectSidePanelDiscussion(
    options: ShowDiscussionOptions & { windowId: number },
): Promise<SidePanelContent> {
    const {
        windowId,
        reservation,
        tabId,
        itemId,
        sourceUrl,
    } = options;
    const projection = await panelContent.showDiscussion(windowId, {
        ...(reservation === undefined ? {} : { reservation }),
        tabId,
        itemId,
        sourceUrl,
    });
    return projection.content;
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
 * Initializes a newly contextualized panel window and returns the exact
 * projection stamp that may become framing-ready.
 * @param windowId - The browser window whose panel connected.
 */
export async function connectSidePanelWindow(
    windowId: number,
): Promise<SidePanelReadyStamp> {
    return sidePanelLifecycle.connectWindow(windowId);
}

/**
 * Cancels unfinished work after a window loses its last live panel port.
 * @param windowId - The disconnected browser window.
 */
export async function disconnectSidePanelWindow(windowId: number): Promise<void> {
    await sidePanelLifecycle.disconnectWindow(windowId);
}

/**
 * Synchronizes one newly active tab when its window has a live panel.
 * @param tabId - The newly active browser tab.
 * @param windowId - The browser window that owns the tab.
 */
export async function activateSidePanelTab(
    tabId: number,
    windowId: number,
): Promise<SidePanelProjection | null> {
    return sidePanelLifecycle.activateTab(tabId, windowId);
}

/**
 * Routes one Chrome activation event through the live-window gate.
 * @param activeInfo - The activated tab and its browser window.
 */
export async function handleSidePanelTabActivated(
    activeInfo: Readonly<{ tabId: number; windowId: number }>,
): Promise<SidePanelProjection | null> {
    return sidePanelLifecycle.activateTab(activeInfo.tabId, activeInfo.windowId);
}

/**
 * Routes URL and completion updates without acquiring an unchecked tab URL.
 * @param tabId - The updated browser tab.
 * @param windowId - The tab's current browser window.
 * @param active - Whether Chrome reports the tab active.
 * @param change - Relevant URL/status fields from tabs.onUpdated.
 */
export async function handleSidePanelTabUpdated(
    tabId: number,
    windowId: number,
    active: boolean,
    change: Readonly<SidePanelTabUpdate>,
): Promise<boolean> {
    return sidePanelLifecycle.updateTab(tabId, windowId, active, change);
}

/**
 * Removes one closed, replaced, or detached tab through the process-wide
 * association queue.
 * @param tabId - The invalid browser tab.
 * @param windowId - Its known former owner when Chrome reports one.
 */
export async function forgetSidePanelTab(tabId: number, windowId?: number): Promise<void> {
    await sidePanelLifecycle.forgetTab(tabId, windowId);
}

/**
 * Cleans up a replaced tab before synchronizing its active successor.
 * @param addedTabId - The replacement browser tab.
 * @param removedTabId - The invalidated prior browser tab.
 */
export async function handleSidePanelTabReplaced(
    addedTabId: number,
    removedTabId: number,
): Promise<void> {
    await sidePanelLifecycle.replaceTab(addedTabId, removedTabId);
}

/**
 * Validates a moved tab's destination before synchronizing it when active.
 * @param tabId - The attached browser tab.
 * @param attachInfo - The destination window reported by Chrome.
 */
export async function handleSidePanelTabAttached(
    tabId: number,
    attachInfo: Readonly<{ newWindowId: number }>,
): Promise<void> {
    await sidePanelLifecycle.attachTab(tabId, attachInfo.newWindowId);
}

/**
 * Restores one live window after an explicit operation cancels.
 * @param reservation - The manager-owned recovery and its browser window.
 */
export async function resynchronizeSidePanelWindow(
    reservation: SidePanelRecoveryReservation,
): Promise<void> {
    await sidePanelLifecycle.resynchronizeWindow(reservation);
}

/**
 * Discards one closed window's selection and its in-flight work.
 * @param windowId - The browser window that was closed.
 */
export async function forgetSidePanelWindow(windowId: number): Promise<void> {
    await sidePanelLifecycle.removeWindow(windowId);
}

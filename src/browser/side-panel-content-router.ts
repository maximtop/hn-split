import type { PanelLookupResult } from '../background/article-lookup';
import type { SidePanelAssociationStore } from './side-panel-association-store';
import {
    SIDE_PANEL_FOLLOW_CONTINUATION_KIND,
    SidePanelContentManager,
} from './side-panel-content-manager';
import type {
    ExpectedNavigationReservation,
    ExplicitOperationReservation,
    ShowDiscussionOptions,
    SidePanelContentDependencies,
    SidePanelFollowActivationToken,
    SidePanelFollowAuthorityToken,
    SidePanelFollowContinuation,
    SidePanelRecoveryAuthority,
} from './side-panel-content-manager';
import { SIDE_PANEL_CONTENT_KIND } from '../shared/side-panel-content';
import type { SidePanelProjection } from '../shared/side-panel-projection';
import type { FollowWarningSink } from '../shared/logger';

const DISABLE_FOLLOW_FAILED_MESSAGE = 'Unable to disable side panel following';

/**
 * Describes one window's stored revisioned side-panel projection.
 */
export interface SidePanelWindowProjection {
    /**
     * Identifies the browser window that owns the projection.
     */
    windowId: number;
    /**
     * Contains the strict revisioned panel state stored for that window.
     */
    projection: SidePanelProjection;
}

/**
 * Carries one opaque manager capture together with its owning browser window.
 */
export interface SidePanelFollowActivationReservation extends SidePanelFollowActivationToken {
    /**
     * Identifies the per-window manager that owns the capture.
     */
    windowId: number;
}

/**
 * Carries one opaque request-time authority revision for a panel window.
 */
export interface SidePanelFollowAuthorityReservation extends SidePanelFollowAuthorityToken {
    /**
     * Identifies the per-window manager that owns the revision.
     */
    windowId: number;
}

/**
 * Carries one opaque manager-owned recovery attempt with its browser window.
 */
export interface SidePanelRecoveryReservation extends SidePanelRecoveryAuthority {
    /**
     * Identifies the per-window manager that owns the recovery attempt.
     */
    windowId: number;
}

/**
 * Defines the process-wide boundaries adapted into one manager per window.
 */
export interface SidePanelContentRouterDependencies {
    /**
     * Coordinates session associations across every window manager.
     */
    associations: Pick<SidePanelAssociationStore, 'mutate' | 'settledGet'>;
    /**
     * Reads one window's last strict projection.
     * @param windowId - The browser window whose projection is read.
     */
    readProjection(windowId: number): Promise<SidePanelProjection | null>;
    /**
     * Persists one window's next strict projection.
     * @param windowId - The browser window that owns the projection.
     * @param projection - The exact projection to persist.
     */
    writeProjection(windowId: number, projection: SidePanelProjection): Promise<void>;
    /**
     * Removes one closed window's stored projection.
     * @param windowId - The closed browser window.
     */
    removeProjection(windowId: number): Promise<void>;
    /**
     * Lists every valid window projection for startup normalization.
     */
    listProjections(): Promise<SidePanelWindowProjection[]>;
    /**
     * Reads the independent follow preference.
     */
    isFollowEnabled(): Promise<boolean>;
    /**
     * Resolves one consented URL through the shared session lookup cache.
     * @param url - The consented page URL to resolve.
     * @param signal - The signal that cancels a superseded resolution.
     */
    lookup(url: string, signal: AbortSignal): Promise<PanelLookupResult>;
    /**
     * Reads one tab's current window ownership without acquiring its URL.
     * @param tabId - The tab whose window ownership is checked.
     */
    getTabWindow(tabId: number): Promise<number | null>;
    /**
     * Normalizes one explicitly authorized or association-backed URL.
     * @param url - The URL whose sanitized identity is requested.
     */
    normalizeArticleUrl(url: string): string | null;
    /**
     * Opens the side panel within the originating user gesture.
     * @param tabId - The tab whose window should reveal the panel.
     */
    openSidePanel(tabId: number): Promise<void>;
    /**
     * Navigates one explicitly targeted tab.
     * @param tabId - The tab to navigate.
     * @param url - The exact target URL.
     */
    navigate(tabId: number, url: string): Promise<void>;
    /**
     * Restores one live window through the normal consent gate after cancellation.
     * @param reservation - The manager-owned recovery and its panel window.
     */
    resynchronize(reservation: SidePanelRecoveryReservation): Promise<void>;
    /**
     * Discards live retained contexts for one tab in one panel window.
     * @param windowId - The browser window whose panel receives the discard.
     * @param tabId - The tab whose contexts are discarded.
     */
    discardFrame(windowId: number, tabId: number): void;
    /**
     * Announces a newer target to one live panel window before storage commits.
     * @param windowId - The browser window whose panel receives the target.
     * @param tabId - The newly authoritative tab.
     * @param minimumProjectionRevision - The first reserved revision.
     */
    target(windowId: number, tabId: number, minimumProjectionRevision: number): void;
    /**
     * Reports one privacy-safe allow-listed failure.
     * @param code - The stable allow-listed warning code.
     * @param details - Ephemeral numeric identifiers only.
     */
    warn: FollowWarningSink;
}

/**
 * Routes synchronization to one persistent newest-wins manager per browser
 * window, while sharing the same process-wide association coordinator.
 */
export class SidePanelContentRouter {
    private readonly managers = new Map<number, SidePanelContentManager>();

    /**
     * Creates a router with no per-window manager instantiated yet.
     * @param dependencies - Process-wide browser, storage, and lookup boundaries.
     */
    constructor(private readonly dependencies: SidePanelContentRouterDependencies) {}

    /**
     * Initializes one newly connected window from its authoritative active tab.
     * @param windowId - The connected panel's browser window.
     * @param tabId - The tab active in that window.
     * @param readUrl - Lazy URL acquisition used only after consent.
     */
    async connect(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).connect(tabId, readUrl);
    }

    /**
     * Reserves an exact expected navigation in one window manager.
     * @param windowId - The window owning the explicit operation.
     * @param tabId - The tab expected to navigate.
     * @param rawUrl - The exact expected target.
     */
    reserveExpectedNavigation(
        windowId: number,
        tabId: number,
        rawUrl: string,
    ): ExpectedNavigationReservation {
        return this.managerFor(windowId).reserveExpectedNavigation(tabId, rawUrl);
    }

    /**
     * Cancels one exact expected navigation in its owning manager.
     * @param windowId - The reservation's browser window.
     * @param reservation - The exact reservation to cancel.
     */
    cancelExpectedNavigation(
        windowId: number,
        reservation: ExpectedNavigationReservation,
    ): void {
        this.managerFor(windowId).cancelExpectedNavigation(reservation);
    }

    /**
     * Reserves one explicit operation in its owning manager.
     * @param windowId - The explicit action's browser window.
     * @param tabId - The explicitly targeted tab.
     */
    reserveExplicitOperation(
        windowId: number,
        tabId: number,
    ): ExplicitOperationReservation {
        return this.managerFor(windowId).reserveExplicitOperation(tabId);
    }

    /**
     * Publishes pending readiness for one exact explicit reservation.
     * @param windowId - The reservation's browser window.
     * @param reservation - The exact explicit operation.
     */
    async prepareExplicitOperation(
        windowId: number,
        reservation: ExplicitOperationReservation,
    ): Promise<SidePanelProjection | null> {
        return this.managerFor(windowId).prepareExplicitOperation(reservation);
    }

    /**
     * Cancels one exact explicit reservation.
     * @param windowId - The reservation's browser window.
     * @param reservation - The exact explicit operation.
     * @param resynchronize - Whether the live target must be restored.
     */
    cancelExplicitOperation(
        windowId: number,
        reservation: ExplicitOperationReservation,
        resynchronize: boolean,
    ): void {
        this.managerFor(windowId).cancelExplicitOperation(reservation, resynchronize);
    }

    /**
     * Publishes one concrete explicit discussion in its owning window.
     * @param windowId - The targeted panel window.
     * @param options - The explicit discussion identity and source page.
     */
    async showDiscussion(
        windowId: number,
        options: ShowDiscussionOptions,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).showDiscussion(options);
    }

    /**
     * Runs one concrete context-menu navigation and lookup pipeline.
     * @param windowId - The targeted panel window.
     * @param tabId - The tab whose link was selected.
     * @param targetUrl - The exact selected target.
     */
    openLink(
        windowId: number,
        tabId: number,
        targetUrl: string,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).openLink(tabId, targetUrl);
    }

    /**
     * Routes one tab navigation to its window manager.
     * @param windowId - The tab's current or prior panel window.
     * @param tabId - The tab that navigated.
     * @param reportedUrl - The optional browser-reported URL.
     * @param active - Whether the tab is active.
     * @param panelLive - Whether this window owns a live panel port.
     */
    async navigation(
        windowId: number,
        tabId: number,
        reportedUrl: string | undefined,
        active: boolean,
        panelLive: boolean,
    ): Promise<SidePanelProjection | null> {
        return this.managerFor(windowId).navigation(tabId, reportedUrl, active, panelLive);
    }

    /**
     * Resumes one already-consented pending URL acquisition.
     * @param windowId - The live panel window.
     * @param tabId - The pending tab.
     * @param readUrl - Lazy status-complete URL acquisition.
     */
    async resumePendingUrl(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        return this.managerFor(windowId).resumePendingUrl(tabId, readUrl);
    }

    /**
     * Synchronizes a newly active tab in one already-live panel window.
     * @param windowId - The panel's browser window.
     * @param tabId - The newly active tab.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    async activate(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).activate(tabId, readUrl);
    }

    /**
     * Continues one manager-owned recovery after its asynchronous active-tab read.
     * @param reservation - The opaque recovery and its owning window.
     * @param tabId - The tab active when the browser read completed.
     * @param readUrl - Lazy ownership-checked URL acquisition.
     */
    async recover(
        reservation: SidePanelRecoveryReservation,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        const manager = this.managers.get(reservation.windowId);
        return manager === undefined
            ? null
            : manager.recover(reservation, tabId, readUrl);
    }

    /**
     * Performs one explicit manual check in the targeted panel window.
     * @param windowId - The panel's browser window.
     * @param tabId - The tab active at trusted action time.
     * @param readUrl - Lazy URL acquisition authorized by the action.
     */
    async restoreOrCheck(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).restoreOrCheck(tabId, readUrl);
    }

    /**
     * Captures one action-time tab in its owning manager without exposing that
     * manager or starting synchronization.
     * @param windowId - The live panel window issuing the action.
     * @param tabId - The tab active at the trusted background boundary.
     */
    reserveFollowActivation(
        windowId: number,
        tabId: number,
    ): SidePanelFollowActivationReservation {
        const reservation = this.managerFor(windowId).reserveFollowActivation(tabId);
        return { windowId, ...reservation };
    }

    /**
     * Captures one manager's current trusted authority without changing state.
     * @param windowId - The panel window whose authority is captured.
     */
    captureFollowAuthority(windowId: number): SidePanelFollowAuthorityReservation {
        return { windowId, ...this.managerFor(windowId).captureFollowAuthority() };
    }

    /**
     * Captures one action-time tab only if an asynchronous active-tab read did
     * not cross another trusted manager boundary.
     * @param authority - The authority captured before reading the active tab.
     * @param tabId - The active tab returned by that read.
     */
    reserveFollowActivationIfCurrent(
        authority: SidePanelFollowAuthorityReservation,
        tabId: number,
    ): SidePanelFollowActivationReservation | null {
        const reservation = this.managerFor(authority.windowId)
            .reserveFollowActivationIfCurrent(tabId, authority);
        return reservation === null
            ? null
            : { windowId: authority.windowId, ...reservation };
    }

    /**
     * Cancels one exact queued follow capture after its setting transaction fails.
     * @param reservation - The opaque per-window capture to cancel.
     */
    cancelFollowActivation(reservation: SidePanelFollowActivationReservation): void {
        this.managers.get(reservation.windowId)?.cancelFollowActivation(reservation);
    }

    /**
     * Continues one exact queued follow capture after consent is persisted.
     * @param reservation - The opaque per-window capture to continue.
     * @param readUrl - Lazy ownership-checked URL acquisition.
     */
    async continueFollowActivation(
        reservation: SidePanelFollowActivationReservation,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        const manager = this.managers.get(reservation.windowId);
        return manager === undefined
            ? null
            : manager.continueFollowActivation(reservation, readUrl);
    }

    /**
     * Continues one capture and reports which newer authority won when it could
     * not run directly.
     * @param reservation - The opaque per-window capture to continue.
     * @param readUrl - Lazy ownership-checked URL acquisition.
     */
    async continueFollowActivationWithStatus(
        reservation: SidePanelFollowActivationReservation,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelFollowContinuation> {
        const manager = this.managers.get(reservation.windowId);
        return manager === undefined
            ? {
                    kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED,
                    projection: null,
                }
            : manager.continueFollowActivationWithStatus(reservation, readUrl);
    }

    /**
     * Synchronizes one live window as the effect of an earlier queued setting
     * operation without invalidating a later trusted one-click capture.
     * @param windowId - The live panel window to synchronize.
     * @param tabId - The tab currently active in that window.
     * @param readUrl - Lazy ownership-checked URL acquisition.
     */
    async synchronizeFollowSetting(
        windowId: number,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        return this.managerFor(windowId).synchronizeFollowSetting(tabId, readUrl);
    }

    /**
     * Applies one queued setting effect only while its request-time manager
     * authority is still current.
     * @param authority - The opaque request-time manager authority.
     * @param tabId - The tab active when the effect runs.
     * @param readUrl - Lazy ownership-checked URL acquisition.
     */
    async synchronizeFollowSettingWithStatus(
        authority: SidePanelFollowAuthorityReservation,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelFollowContinuation> {
        return this.managerFor(authority.windowId).synchronizeFollowSettingWithStatus(
            authority,
            tabId,
            readUrl,
        );
    }

    /**
     * Cancels unfinished automatic work in every instantiated manager after
     * follow is disabled, including a manager racing with panel disconnect.
     */
    async disableAutomatic(): Promise<void> {
        const results = await Promise.allSettled(
            [...this.managers.values()].map(async (manager) => manager.disableAutomatic()),
        );
        const failures: unknown[] = [];
        for (const result of results) {
            if (result.status === 'rejected') {
                failures.push(result.reason as unknown);
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, DISABLE_FOLLOW_FAILED_MESSAGE);
        }
    }

    /**
     * Cancels unfinished work after one window loses its last live panel port,
     * without deleting its completed projection or reusable associations.
     * @param windowId - The browser window whose panel disconnected.
     */
    async disconnectWindow(windowId: number): Promise<void> {
        await this.managers.get(windowId)?.disconnect();
    }

    /**
     * Removes one invalid tab association and cancels every known manager intent
     * that can still target it.
     * @param tabId - The closed, replaced, or detached tab.
     * @param windowId - The known former owner, when Chrome reports one.
     */
    async forgetTab(tabId: number, windowId?: number): Promise<void> {
        if (windowId !== undefined) {
            await this.managerFor(windowId).forgetTab(tabId);
            return;
        }
        const managers = [...this.managers.values()];
        if (managers.length === 0) {
            await this.dependencies.associations.mutate(tabId, () => ({ kind: 'remove' }));
            return;
        }
        await Promise.all(managers.map(async (manager) => manager.forgetTab(tabId)));
    }

    /**
     * Normalizes every persisted pending projection after a worker restart.
     */
    async normalizeStartupContent(): Promise<void> {
        const entries = await this.dependencies.listProjections();
        await Promise.all(entries
            .filter(({ projection }) => projection.content.kind === SIDE_PANEL_CONTENT_KIND.PENDING)
            .map(async ({ windowId }) => this.managerFor(windowId).normalizeStartupContent()));
    }

    /**
     * Discards one closed window's owner and removes its stored projection.
     * @param windowId - The closed browser window.
     */
    async forgetWindow(windowId: number): Promise<void> {
        this.managers.get(windowId)?.discard();
        this.managers.delete(windowId);
        await this.dependencies.removeProjection(windowId);
    }

    /**
     * Returns one window's persistent manager, creating its exact adapters once.
     * @param windowId - The browser window whose manager is requested.
     */
    private managerFor(windowId: number): SidePanelContentManager {
        const existing = this.managers.get(windowId);
        if (existing !== undefined) {
            return existing;
        }
        const { dependencies } = this;
        const managerDependencies: SidePanelContentDependencies = {
            associations: dependencies.associations,
            readProjection: async () => dependencies.readProjection(windowId),
            writeProjection: async (projection) => dependencies.writeProjection(windowId, projection),
            isFollowEnabled: async () => dependencies.isFollowEnabled(),
            lookup: async (url, signal) => dependencies.lookup(url, signal),
            getTabWindow: async (tabId) => dependencies.getTabWindow(tabId),
            normalizeArticleUrl: (url) => dependencies.normalizeArticleUrl(url),
            openSidePanel: async (tabId) => dependencies.openSidePanel(tabId),
            navigate: async (tabId, url) => dependencies.navigate(tabId, url),
            resynchronize: async (authority) => dependencies.resynchronize({
                windowId,
                ...authority,
            }),
            discardFrame: (tabId) => dependencies.discardFrame(windowId, tabId),
            target: (tabId, minimumProjectionRevision) => {
                dependencies.target(windowId, tabId, minimumProjectionRevision);
            },
            warn: (code, details) => {
                dependencies.warn(code, details);
            },
        };
        const manager = new SidePanelContentManager(windowId, managerDependencies);
        this.managers.set(windowId, manager);
        return manager;
    }
}

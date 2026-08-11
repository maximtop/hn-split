import type { PanelLookupResult } from '../background/article-lookup';
import type { SidePanelAssociationStore } from './side-panel-association-store';
import { HN_LOOKUP_ERROR_REASON, HN_LOOKUP_STATUS } from '../domain/hn';
import { isWebUrl } from '../domain/url';
import {
    SIDE_PANEL_ASSOCIATION_ORIGIN,
} from '../shared/side-panel-association';
import type {
    SidePanelAssociation,
    SidePanelAssociationOrigin,
} from '../shared/side-panel-association';
import {
    SIDE_PANEL_CONTENT_KIND,
    contentForLookupResult,
} from '../shared/side-panel-content';
import type { SidePanelContent } from '../shared/side-panel-content';
import type { SidePanelProjection } from '../shared/side-panel-projection';
import { FOLLOW_DIAGNOSTIC_CODE } from '../shared/logger';
import type {
    FollowDiagnosticDetails,
    FollowWarningSink,
} from '../shared/logger';

const SUPERSEDED_INTENT_MESSAGE = 'Side panel intent was superseded';

const EXPECTED_NAVIGATION_MATCH = {
    NONE: 'none',
    MATCHED: 'matched',
    MISMATCHED: 'mismatched',
} as const;

type ExpectedNavigationMatch = typeof EXPECTED_NAVIGATION_MATCH[
    keyof typeof EXPECTED_NAVIGATION_MATCH
];

/**
 * Carries one opaque manager-owned recovery attempt across asynchronous browser
 * reads without allowing stale lifecycle work to regain visible authority.
 */
export interface SidePanelRecoveryAuthority {
    /**
     * Identifies this exact recovery attempt within the manager lifetime.
     */
    token: number;
    /**
     * Aborts when a newer trusted manager boundary supersedes the recovery.
     */
    signal: AbortSignal;
}

/**
 * Defines the consent, storage, lookup, and live-panel boundaries used by one
 * window's side-panel synchronization owner.
 */
export interface SidePanelContentDependencies {
    /**
     * Coordinates all session associations through the process-wide per-tab FIFO.
     */
    associations: Pick<SidePanelAssociationStore, 'mutate' | 'settledGet'>;
    /**
     * Reads the last strict projection stored for this manager's window.
     */
    readProjection(): Promise<SidePanelProjection | null>;
    /**
     * Persists one strict revisioned projection for this manager's window.
     * @param projection - The exact projection to persist.
     */
    writeProjection(projection: SidePanelProjection): Promise<void>;
    /**
     * Reads the independent side-panel-follow preference.
     */
    isFollowEnabled(): Promise<boolean>;
    /**
     * Resolves one consented page URL through the shared lookup cache.
     * @param url - The consented page URL to resolve.
     * @param signal - The signal that aborts a superseded resolution.
     */
    lookup(url: string, signal: AbortSignal): Promise<PanelLookupResult>;
    /**
     * Reads the current browser window ownership of one tab without its URL.
     * @param tabId - The tab whose window ownership is checked.
     */
    getTabWindow(tabId: number): Promise<number | null>;
    /**
     * Normalizes one URL only after association state or explicit consent
     * authorizes inspecting it.
     * @param url - The URL whose privacy-safe identity is requested.
     */
    normalizeArticleUrl(url: string): string | null;
    /**
     * Opens the side panel within an explicit browser gesture.
     * @param tabId - The tab whose window should reveal the panel.
     */
    openSidePanel(tabId: number): Promise<void>;
    /**
     * Navigates one tab after a concrete context-menu selection.
     * @param tabId - The explicitly targeted tab.
     * @param url - The exact user-selected URL.
     */
    navigate(tabId: number, url: string): Promise<void>;
    /**
     * Re-runs the live-window consent gate after an explicit operation cancels.
     * @param authority - The manager-owned recovery attempt to preserve across browser reads.
     */
    resynchronize(authority: SidePanelRecoveryAuthority): Promise<void>;
    /**
     * Asks the live panel to discard every retained frame for one tab.
     * @param tabId - The tab whose retained contexts are discarded.
     */
    discardFrame(tabId: number): void;
    /**
     * Announces a newer authoritative target before its queued write completes.
     * @param tabId - The newly authoritative tab.
     * @param minimumProjectionRevision - The first projection revision for the intent.
     */
    target(tabId: number, minimumProjectionRevision: number): void;
    /**
     * Reports one privacy-safe, allow-listed synchronization failure.
     * @param code - The stable allow-listed failure code.
     * @param details - Ephemeral numeric identifiers only.
     */
    warn: FollowWarningSink;
}

/**
 * Tracks one newest-wins panel synchronization operation.
 */
interface SynchronizationIntent {
    /**
     * Identifies this manager operation monotonically within the worker lifetime.
     */
    generation: number;
    /**
     * Identifies the user authority behind this operation.
     */
    cause: 'automatic' | 'explicit' | 'manual';
    /**
     * Identifies the tab whose state this operation may publish.
     */
    tabId: number;
    /**
     * Reserves the first projection revision announced by TARGET.
     */
    firstProjectionRevision: number;
    /**
     * Records whether the reserved first revision has already been consumed.
     */
    hasPublished: boolean;
}

/**
 * Identifies one exact, worker-memory-only navigation expectation.
 */
export interface ExpectedNavigationReservation {
    /**
     * Identifies the tab expected to navigate.
     */
    tabId: number;
    /**
     * Identifies this exact reservation within the worker lifetime.
     */
    token: number;
}

/**
 * Identifies one action-time tab captured for a queued follow transaction.
 */
export interface SidePanelFollowActivationToken {
    /**
     * Identifies the tab active at the trusted request boundary.
     */
    tabId: number;
    /**
     * Identifies this exact capture within the manager lifetime.
     */
    token: number;
}

/**
 * Captures the manager authority revision at a serialized setting boundary.
 */
export interface SidePanelFollowAuthorityToken {
    /**
     * Identifies the newest trusted manager boundary observed by the caller.
     */
    token: number;
}

/**
 * Names why a captured follow activation could not continue directly.
 */
export const SIDE_PANEL_FOLLOW_CONTINUATION_KIND = {
    CONTINUED: 'continued',
    ACTIVE_TAB_CHANGED: 'active_tab_changed',
    SUPERSEDED: 'superseded',
} as const;

/**
 * Reports whether a queued follow activation continued, yielded to a real tab
 * activation, or preserved a newer explicit/manual operation.
 */
export type SidePanelFollowContinuation =
    | {
        kind: typeof SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED;
        projection: SidePanelProjection;
    }
    | {
        kind: typeof SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED;
    }
    | {
        kind: typeof SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED;
        projection: SidePanelProjection | null;
    };

/**
 * Carries the public handles for one explicit newest-wins operation.
 */
export interface ExplicitOperationReservation {
    /**
     * Identifies the explicitly targeted tab.
     */
    tabId: number;
    /**
     * Identifies this exact operation within the worker lifetime.
     */
    token: number;
    /**
     * Resolves when the first pending or terminal projection is applied.
     */
    readiness: Promise<SidePanelProjection | null>;
    /**
     * Resolves after terminal association persistence finishes.
     */
    completion: Promise<SidePanelProjection | null>;
}

/**
 * Describes one explicit discussion selection and its originating page.
 */
export interface ShowDiscussionOptions {
    /**
     * Reuses a synchronously reserved operation when one exists.
     */
    reservation?: ExplicitOperationReservation;
    /**
     * Identifies the article tab receiving the discussion.
     */
    tabId: number;
    /**
     * Identifies the concrete Hacker News discussion.
     */
    itemId: string;
    /**
     * Contains the inspected article page URL, never the Algolia hit URL.
     */
    sourceUrl: string;
}

/**
 * Retains the raw expected target only in worker memory.
 */
interface ExpectedNavigationController extends ExpectedNavigationReservation {
    /**
     * Contains the exact browser navigation target.
     */
    rawUrl: string;
    /**
     * Contains its sanitized identity when the URL is eligible.
     */
    articleIdentity: string | null;
    /**
     * Identifies the explicit operation that keeps this guard alive until settlement.
     */
    pairedExplicitToken: number | null;
    /**
     * Prevents a completed action's delayed-navigation guard from being rebound.
     */
    hasBeenPaired: boolean;
    /**
     * Records whether the expected target has already been observed once.
     */
    matched: boolean;
}

/**
 * Owns the internal start/readiness/completion settlement for an explicit action.
 */
interface ExplicitOperationController {
    /**
     * Identifies the explicitly targeted tab.
     */
    tabId: number;
    /**
     * Identifies this operation within the worker lifetime.
     */
    token: number;
    /**
     * Contains the hydrated explicit intent after start.
     */
    intent: SynchronizationIntent | null;
    /**
     * Resolves after hydration installs the intent, or null on cancellation.
     */
    started: Promise<SynchronizationIntent | null>;
    /**
     * Carries the public operation handles.
     */
    reservation: ExplicitOperationReservation;
    /**
     * Prevents duplicate settlement across superseding paths.
     */
    settled: boolean;
    /**
     * Prevents more than one readiness projection from being published.
     */
    readinessSettled: boolean;
    /**
     * Resolves the internal hydration barrier.
     * @param intent - The installed intent, or null when cancelled first.
     */
    resolveStarted(intent: SynchronizationIntent | null): void;
    /**
     * Resolves the first-projection readiness handle.
     * @param projection - The first applied projection, or null on cancellation.
     */
    resolveReadiness(projection: SidePanelProjection | null): void;
    /**
     * Resolves terminal completion.
     * @param projection - The terminal projection, or null on cancellation.
     */
    resolveCompletion(projection: SidePanelProjection | null): void;
}

/**
 * Retains one queued follow capture until its setting transaction consumes it.
 */
interface FollowActivationController extends SidePanelFollowActivationToken {
    /**
     * Records the newest boundary that superseded this capture.
     */
    supersededBy: 'activation' | 'other' | null;
}

/**
 * Creates one exactly-once explicit operation controller.
 * @param tabId - The explicitly targeted tab.
 * @param token - The worker-local operation token.
 */
function createExplicitOperationController(
    tabId: number,
    token: number,
): ExplicitOperationController {
    let resolveStarted: (intent: SynchronizationIntent | null) => void = () => undefined;
    let resolveReadiness: (projection: SidePanelProjection | null) => void = () => undefined;
    let resolveCompletion: (projection: SidePanelProjection | null) => void = () => undefined;
    const started = new Promise<SynchronizationIntent | null>((resolve) => {
        resolveStarted = resolve;
    });
    const readiness = new Promise<SidePanelProjection | null>((resolve) => {
        resolveReadiness = resolve;
    });
    const completion = new Promise<SidePanelProjection | null>((resolve) => {
        resolveCompletion = resolve;
    });
    return {
        tabId,
        token,
        intent: null,
        started,
        reservation: { tabId, token, readiness, completion },
        settled: false,
        readinessSettled: false,
        resolveStarted,
        resolveReadiness,
        resolveCompletion,
    };
}

/**
 * Creates the standard abort surfaced by a superseded synchronization intent.
 */
function supersededIntentError(): DOMException {
    return new DOMException(SUPERSEDED_INTENT_MESSAGE, 'AbortError');
}

/**
 * Requires a queued projection to have applied while its intent was current.
 * @param value - The nullable queued projection result.
 */
function requireApplied(value: SidePanelProjection | null): SidePanelProjection {
    if (value === null) {
        throw supersededIntentError();
    }
    return value;
}

/**
 * Reconstructs strict tab-aware content from one reusable association.
 * @param association - The validated session association to restore.
 */
function contentForAssociation(association: SidePanelAssociation): SidePanelContent {
    if (association.outcome.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION) {
        return {
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            tabId: association.tabId,
            itemId: association.outcome.itemId,
        };
    }
    return {
        kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
        tabId: association.tabId,
        reason: association.outcome.reason,
    };
}

/**
 * Owns the newest-wins, consent-gated side-panel projection for one browser
 * window. The manager never reads a tab URL until a reusable association has
 * missed and either follow consent or a one-shot manual action authorizes it.
 */
export class SidePanelContentManager {
    private generation = 0;

    private controller: AbortController | null = null;

    private projectionQueue: Promise<void> = Promise.resolve();

    private currentIntent: SynchronizationIntent | null = null;

    private currentProjection: SidePanelProjection | null = null;

    private nextProjectionRevision = 0;

    private initialization: Promise<void> | null = null;

    private expectedNavigationToken = 0;

    private explicitOperationToken = 0;

    private followActivationToken = 0;

    private followAuthorityToken = 0;

    private followAuthorityCause: 'activation' | 'other' = 'activation';

    private recoveryToken = 0;

    private recoveryController: AbortController | null = null;

    private readonly expectedNavigations = new Map<number, ExpectedNavigationController>();

    private readonly explicitOperations = new Map<number, ExplicitOperationController>();

    private readonly followActivations = new Map<number, FollowActivationController>();

    private followActivation: FollowActivationController | null = null;

    private manualCheck: Promise<SidePanelProjection> | null = null;

    private awaitingUrlIntent: SynchronizationIntent | null = null;

    /**
     * Creates one manager fixed to one browser window.
     * @param windowId - The browser window this manager exclusively owns.
     * @param dependencies - Consent, storage, lookup, and live-panel boundaries.
     */
    constructor(
        private readonly windowId: number,
        private readonly dependencies: SidePanelContentDependencies,
    ) {}

    /**
     * Captures the current trusted authority revision without changing state.
     */
    captureFollowAuthority(): SidePanelFollowAuthorityToken {
        return { token: this.followAuthorityToken };
    }

    /**
     * Captures a one-click follow activation only while an earlier active-tab
     * read still belongs to the same trusted authority revision.
     * @param tabId - The tab returned by the trusted active-tab read.
     * @param authority - The revision captured before that asynchronous read.
     */
    reserveFollowActivationIfCurrent(
        tabId: number,
        authority: SidePanelFollowAuthorityToken,
    ): SidePanelFollowActivationToken | null {
        return authority.token === this.followAuthorityToken
            ? this.reserveFollowActivation(tabId)
            : null;
    }

    /**
     * Captures the trusted action-time tab without reading storage, acquiring a
     * URL, allocating a projection revision, or changing visible content.
     * @param tabId - The tab active when the background accepted the action.
     */
    reserveFollowActivation(tabId: number): SidePanelFollowActivationToken {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        const controller: FollowActivationController = {
            tabId,
            token: this.followActivationToken + 1,
            supersededBy: null,
        };
        this.followActivationToken = controller.token;
        this.followActivation = controller;
        this.followActivations.set(controller.token, controller);
        return { tabId: controller.tabId, token: controller.token };
    }

    /**
     * Cancels one exact queued follow capture after its setting transaction
     * fails before synchronization begins.
     * @param reservation - The exact capture returned by reserveFollowActivation.
     */
    cancelFollowActivation(reservation: SidePanelFollowActivationToken): void {
        const controller = this.followActivationController(reservation);
        if (controller === null) {
            return;
        }
        if (this.followActivation === controller) {
            this.followActivation = null;
        }
        this.followActivations.delete(controller.token);
    }

    /**
     * Continues one unchanged action-time capture after follow consent has been
     * persisted, while reporting whether a newer trusted boundary won instead.
     * @param reservation - The exact queued follow capture.
     * @param readUrl - Lazy URL acquisition used only after association restore.
     */
    async continueFollowActivationWithStatus(
        reservation: SidePanelFollowActivationToken,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelFollowContinuation> {
        const controller = this.followActivationController(reservation);
        if (controller === null) {
            return {
                kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED,
                projection: this.currentProjection,
            };
        }
        if (this.followActivation !== controller || controller.supersededBy !== null) {
            try {
                return await this.followSupersession(controller);
            } finally {
                this.followActivations.delete(controller.token);
            }
        }
        this.followActivation = null;
        try {
            const projection = await this.activateCapturedTab(controller.tabId, readUrl);
            return {
                kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED,
                projection,
            };
        } catch (error) {
            if (error instanceof DOMException
                && error.name === 'AbortError'
                && controller.supersededBy !== null) {
                return this.followSupersession(controller);
            }
            throw error;
        } finally {
            this.followActivations.delete(controller.token);
        }
    }

    /**
     * Continues one exact follow capture, returning null when a newer trusted
     * boundary superseded it.
     * @param reservation - The exact queued follow capture.
     * @param readUrl - Lazy consented URL acquisition.
     */
    async continueFollowActivation(
        reservation: SidePanelFollowActivationToken,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        const result = await this.continueFollowActivationWithStatus(reservation, readUrl);
        return result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED
            ? result.projection
            : null;
    }

    /**
     * Reserves one exact expected navigation before an explicit browser action.
     * The raw URL never leaves this in-memory controller.
     * @param tabId - The tab expected to navigate.
     * @param rawUrl - The exact target chosen by the user.
     */
    reserveExpectedNavigation(
        tabId: number,
        rawUrl: string,
    ): ExpectedNavigationReservation {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        const controller: ExpectedNavigationController = {
            tabId,
            token: this.expectedNavigationToken + 1,
            rawUrl,
            articleIdentity: this.dependencies.normalizeArticleUrl(rawUrl),
            pairedExplicitToken: null,
            hasBeenPaired: false,
            matched: false,
        };
        this.expectedNavigationToken = controller.token;
        this.expectedNavigations.set(tabId, controller);
        return { tabId, token: controller.token };
    }

    /**
     * Cancels one exact expected navigation without affecting a replacement.
     * @param reservation - The reservation returned at the explicit boundary.
     */
    cancelExpectedNavigation(reservation: ExpectedNavigationReservation): void {
        const current = this.expectedNavigations.get(reservation.tabId);
        if (current?.token === reservation.token) {
            this.expectedNavigations.delete(reservation.tabId);
        }
    }

    /**
     * Reports whether one tab still has an unconsumed exact expectation.
     * @param tabId - The tab whose expectation is inspected.
     */
    hasExpectedNavigation(tabId: number): boolean {
        return this.expectedNavigations.has(tabId);
    }

    /**
     * Reserves one explicit newest-wins operation before opening UI or awaiting
     * browser storage. Hydration installs its intent asynchronously.
     * @param tabId - The explicitly targeted tab.
     */
    reserveExplicitOperation(tabId: number): ExplicitOperationReservation {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        const existing = this.explicitOperations.get(tabId);
        if (existing !== undefined) {
            this.settleExplicitOperation(existing, null);
        }
        const controller = createExplicitOperationController(
            tabId,
            this.explicitOperationToken + 1,
        );
        this.explicitOperationToken = controller.token;
        const expected = this.expectedNavigations.get(tabId);
        if (expected !== undefined && !expected.hasBeenPaired) {
            expected.pairedExplicitToken = controller.token;
            expected.hasBeenPaired = true;
        } else if (expected?.pairedExplicitToken === null) {
            this.expectedNavigations.delete(tabId);
        }
        this.explicitOperations.set(tabId, controller);
        void this.ensureInitialized().then(
            () => this.startExplicitOperation(controller),
            () => this.settleExplicitOperation(controller, null),
        );
        return controller.reservation;
    }

    /**
     * Publishes pending for a previously reserved explicit operation.
     * @param reservation - The exact explicit operation to prepare.
     */
    async prepareExplicitOperation(
        reservation: ExplicitOperationReservation,
    ): Promise<SidePanelProjection | null> {
        const controller = this.explicitController(reservation);
        if (controller === null) {
            return null;
        }
        const intent = await controller.started;
        if (intent === null || this.explicitController(reservation) !== controller) {
            return null;
        }
        if (controller.readinessSettled) {
            return controller.reservation.readiness;
        }
        const projection = await this.publish(intent, {
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: reservation.tabId,
        });
        this.settleExplicitReadiness(controller, projection);
        return projection;
    }

    /**
     * Cancels one exact explicit reservation and optionally restores the live
     * window through the ordinary consent gate.
     * @param reservation - The exact operation to cancel.
     * @param resynchronize - Whether a reserved target must be replaced.
     */
    cancelExplicitOperation(
        reservation: ExplicitOperationReservation,
        resynchronize: boolean,
    ): void {
        const controller = this.explicitController(reservation);
        if (controller === null) {
            return;
        }
        if (controller.intent !== null && this.isCurrent(controller.intent)) {
            this.invalidateIntent(controller.intent);
        } else {
            this.settleExplicitOperation(controller, null);
        }
        if (resynchronize) {
            this.resynchronize();
        }
    }

    /**
     * Publishes one concrete discussion selected by an explicit entry point.
     * @param options - Tab identity, item identity, source URL, and reservation.
     */
    async showDiscussion(options: ShowDiscussionOptions): Promise<SidePanelProjection> {
        const reservation = options.reservation
            ?? this.reserveExplicitOperation(options.tabId);
        const controller = this.explicitController(reservation);
        if (controller === null || reservation.tabId !== options.tabId) {
            throw supersededIntentError();
        }
        try {
            const intent = await controller.started;
            if (intent === null || this.explicitController(reservation) !== controller) {
                throw supersededIntentError();
            }
            this.requireCurrent(intent);
            await this.requireTabOwnership(intent);
            const content: SidePanelContent = {
                kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
                tabId: options.tabId,
                itemId: options.itemId,
            };
            const projection = requireApplied(await this.publish(intent, content, true));
            this.settleExplicitReadiness(controller, projection);
            const association: SidePanelAssociation = {
                tabId: options.tabId,
                windowId: this.windowId,
                origin: SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                outcome: { kind: content.kind, itemId: content.itemId },
                articleIdentity: this.dependencies.normalizeArticleUrl(options.sourceUrl),
            };
            await this.persistAssociation(association);
            this.settleExplicitOperation(controller, projection);
            return projection;
        } catch (error) {
            const mayResynchronize = controller.token === this.explicitOperationToken
                && this.explicitController(reservation) === controller;
            this.settleExplicitOperation(controller, null);
            if (mayResynchronize) {
                this.resynchronize();
            }
            throw error;
        }
    }

    /**
     * Runs the concrete context-menu pipeline while preserving the initiating
     * click gesture for side-panel opening.
     * @param tabId - The tab whose clicked link is opened.
     * @param targetUrl - The exact selected link target.
     */
    openLink(tabId: number, targetUrl: string): Promise<SidePanelProjection> {
        const expected = isWebUrl(targetUrl)
            ? this.reserveExpectedNavigation(tabId, targetUrl)
            : null;
        const explicit = this.reserveExplicitOperation(tabId);
        const completion = this.completeOpenLink(tabId, targetUrl, expected, explicit);
        void this.dependencies.openSidePanel(tabId).catch(() => {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.OPEN_FAILED, { tabId });
        });
        return completion;
    }

    /**
     * Initializes a newly connected panel from its active tab.
     * @param tabId - The authoritative active tab reported for this window.
     * @param readUrl - Lazy URL acquisition used only after consent is established.
     */
    async connect(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        this.advanceFollowAuthority('activation');
        this.supersedeFollowActivations('activation');
        await this.ensureInitialized();
        while (true) {
            const controller = this.explicitOperations.get(tabId);
            if (controller === undefined) {
                break;
            }
            const projection = await controller.reservation.readiness;
            if (projection !== null) {
                return projection;
            }
        }
        return this.activate(tabId, readUrl);
    }

    /**
     * Processes one browser navigation with association identity and consent
     * checks ordered before any untrusted URL inspection.
     * @param tabId - The tab that reported the navigation.
     * @param reportedUrl - The optional URL carried by the browser event.
     * @param active - Whether the tab is active in its window.
     * @param panelLive - Whether this window currently owns a live panel port.
     */
    async navigation(
        tabId: number,
        reportedUrl: string | undefined,
        active: boolean,
        panelLive: boolean,
    ): Promise<SidePanelProjection | null> {
        if (panelLive && active) {
            this.advanceFollowAuthority('activation');
        }
        await this.ensureInitialized();
        if (reportedUrl !== undefined) {
            const expected = this.consumeExpectedNavigation(tabId, reportedUrl);
            if (expected === EXPECTED_NAVIGATION_MATCH.MATCHED) {
                return null;
            }
            if (expected === EXPECTED_NAVIGATION_MATCH.MISMATCHED) {
                const explicit = this.explicitOperations.get(tabId);
                if (explicit !== undefined) {
                    this.cancelExplicitOperation(explicit.reservation, true);
                }
            }
        }

        const reservedIntent = panelLive
            && active
            && this.currentProjection?.content.tabId === tabId
            && this.currentProjection.content.kind !== SIDE_PANEL_CONTENT_KIND.PENDING
            ? this.beginRequest('automatic', tabId)
            : null;

        let changed = false;
        let association: SidePanelAssociation | null = null;
        try {
            association = await this.dependencies.associations.mutate(tabId, (current) => {
                if (current === null || current.windowId !== this.windowId) {
                    return { kind: 'keep' };
                }
                if (current.articleIdentity === null) {
                    changed = true;
                    return { kind: 'remove' };
                }
                if (reportedUrl === undefined) {
                    return { kind: 'keep' };
                }
                const nextIdentity = this.dependencies.normalizeArticleUrl(reportedUrl);
                if (nextIdentity === current.articleIdentity) {
                    return { kind: 'keep' };
                }
                changed = true;
                return { kind: 'remove' };
            });
        } catch {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED, { tabId });
        }

        if (changed) {
            this.dependencies.discardFrame(tabId);
        }
        const reusable = association?.windowId === this.windowId ? association : null;
        if (reusable !== null) {
            if (!panelLive || !active) {
                return null;
            }
            const intent = reservedIntent ?? this.beginRequest('automatic', tabId);
            await this.requireTabOwnership(intent);
            return requireApplied(await this.publish(
                intent,
                contentForAssociation(reusable),
                true,
            ));
        }
        if (!panelLive || !active) {
            return null;
        }
        const followEnabled = await this.dependencies.isFollowEnabled();
        if (!followEnabled) {
            if (!changed && reservedIntent === null) {
                return null;
            }
            const intent = reservedIntent ?? this.beginRequest('manual', tabId);
            await this.requireTabOwnership(intent);
            return requireApplied(await this.publish(intent, {
                kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
                tabId,
            }, true));
        }
        const intent = reservedIntent ?? this.beginRequest('automatic', tabId);
        const pendingProjection = requireApplied(await this.publish(intent, {
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId,
        }));
        if (reportedUrl === undefined) {
            this.awaitingUrlIntent = intent;
            return pendingProjection;
        }
        return this.resolveUrl(
            intent,
            reportedUrl,
            SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC,
        );
    }

    /**
     * Completes a consented automatic activation whose first browser event did
     * not include the URL.
     * @param tabId - The still-current pending tab.
     * @param readUrl - Lazy status-complete URL acquisition.
     */
    async resumePendingUrl(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        const intent = this.awaitingUrlIntent;
        if (intent === null || intent.tabId !== tabId || !this.isCurrent(intent)) {
            return null;
        }
        const url = await readUrl();
        this.requireCurrent(intent);
        if (url === undefined) {
            return this.currentProjection;
        }
        this.awaitingUrlIntent = null;
        return this.resolveUrl(intent, url, SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC);
    }

    /**
     * Synchronizes one newly active tab, first restoring any reusable session
     * association and otherwise enforcing the independent follow preference.
     * @param tabId - The newly authoritative tab.
     * @param readUrl - Lazy URL acquisition used only when follow is enabled.
     */
    async activate(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        this.advanceFollowAuthority('activation');
        this.supersedeFollowActivations('activation');
        return this.activateCapturedTab(tabId, readUrl);
    }

    /**
     * Continues one manager-owned recovery only if no newer trusted action
     * crossed the lifecycle coordinator's asynchronous active-tab read.
     * @param authority - The exact opaque recovery attempt to continue.
     * @param tabId - The tab active when the browser read completed.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    async recover(
        authority: SidePanelRecoveryAuthority,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection | null> {
        await this.ensureInitialized();
        if (!this.isRecoveryCurrent(authority)) {
            return null;
        }
        this.recoveryController = null;
        return this.activateInitializedTab(tabId, readUrl);
    }

    /**
     * Synchronizes a live window for an earlier serialized setting transaction
     * without invalidating a later one-click capture already waiting in queue.
     * @param tabId - The tab active in the live panel window.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    async synchronizeFollowSetting(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        const result = await this.synchronizeFollowSettingWithStatus(
            this.captureFollowAuthority(),
            tabId,
            readUrl,
        );
        if (result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED) {
            return result.projection;
        }
        const projection = result.kind === SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED
            ? result.projection
            : this.currentProjection;
        if (projection === null) {
            throw supersededIntentError();
        }
        return projection;
    }

    /**
     * Applies one queued setting synchronization only while no newer trusted
     * activation, explicit selection, or manual check has taken authority.
     * @param authority - The manager revision captured at request time.
     * @param tabId - The tab active when the setting effect is applied.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    async synchronizeFollowSettingWithStatus(
        authority: SidePanelFollowAuthorityToken,
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelFollowContinuation> {
        if (authority.token !== this.followAuthorityToken) {
            return this.followAuthoritySupersession();
        }
        const newerProjection = await this.newestManualOrExplicitProjection();
        if (newerProjection !== null) {
            return {
                kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED,
                projection: newerProjection,
            };
        }
        try {
            const projection = await this.activateCapturedTab(tabId, readUrl);
            return {
                kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.CONTINUED,
                projection,
            };
        } catch (error) {
            if (error instanceof DOMException
                && error.name === 'AbortError'
                && authority.token !== this.followAuthorityToken) {
                return this.followAuthoritySupersession();
            }
            throw error;
        }
    }

    /**
     * Executes the shared activation pipeline after its caller has established
     * whether queued follow captures should be superseded.
     * @param tabId - The authoritative tab to synchronize.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    private async activateCapturedTab(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        await this.ensureInitialized();
        return this.activateInitializedTab(tabId, readUrl);
    }

    /**
     * Starts the shared activation pipeline after hydration and any caller-owned
     * authority check have completed without another asynchronous gap.
     * @param tabId - The authoritative tab to synchronize.
     * @param readUrl - Lazy URL acquisition used only after follow consent.
     */
    private async activateInitializedTab(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        const intent = this.beginRequest('automatic', tabId);
        const pendingProjection = requireApplied(await this.publish(intent, {
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId,
        }));
        const association = await this.readAssociation(tabId);
        this.requireCurrent(intent);
        if (association?.windowId === this.windowId) {
            await this.requireTabOwnership(intent);
            return requireApplied(await this.publish(
                intent,
                contentForAssociation(association),
                true,
            ));
        }
        const followEnabled = await this.dependencies.isFollowEnabled();
        this.requireCurrent(intent);
        if (!followEnabled) {
            await this.requireTabOwnership(intent);
            return requireApplied(await this.publish(intent, {
                kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
                tabId,
            }, true));
        }
        const url = await readUrl();
        this.requireCurrent(intent);
        if (url === undefined) {
            this.awaitingUrlIntent = intent;
            return pendingProjection;
        }
        return this.resolveUrl(intent, url, SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC);
    }

    /**
     * Performs one explicitly requested check without reading or changing the
     * follow preference, while still restoring reusable state first.
     * @param tabId - The tab active at the trusted action boundary.
     * @param readUrl - Lazy URL acquisition authorized by this manual action.
     */
    async restoreOrCheck(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<SidePanelProjection> {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        const operation = (async (): Promise<SidePanelProjection> => {
            await this.ensureInitialized();
            const intent = this.beginRequest('manual', tabId);
            requireApplied(await this.publish(intent, {
                kind: SIDE_PANEL_CONTENT_KIND.PENDING,
                tabId,
            }));
            const association = await this.readAssociation(tabId);
            this.requireCurrent(intent);
            if (association?.windowId === this.windowId) {
                await this.requireTabOwnership(intent);
                return requireApplied(await this.publish(
                    intent,
                    contentForAssociation(association),
                    true,
                ));
            }
            const url = await readUrl();
            this.requireCurrent(intent);
            if (url === undefined) {
                await this.requireTabOwnership(intent);
                return requireApplied(await this.publish(intent, {
                    kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
                    tabId,
                    reason: HN_LOOKUP_STATUS.ERROR,
                }, true));
            }
            return this.resolveUrl(intent, url, SIDE_PANEL_ASSOCIATION_ORIGIN.MANUAL);
        })();
        this.manualCheck = operation;
        try {
            return await operation;
        } finally {
            if (this.manualCheck === operation) {
                this.manualCheck = null;
            }
        }
    }

    /**
     * Stops unfinished automatic work and replaces its transient state with the
     * one-shot choices, while preserving any already committed terminal result.
     */
    async disableAutomatic(): Promise<void> {
        const automatic = this.currentIntent;
        if (automatic?.cause !== 'automatic') {
            return;
        }
        this.invalidateIntent(automatic);
        const manual = this.beginRequest('manual', automatic.tabId);
        requireApplied(await this.publish(manual, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: automatic.tabId,
        }, true));
    }

    /**
     * Removes one tab's reusable association after every earlier mutation and
     * invalidates any in-flight operation that still targets that tab.
     * @param tabId - The closed, replaced, detached, or otherwise invalid tab.
     */
    async forgetTab(tabId: number): Promise<void> {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other', tabId);
        this.expectedNavigations.delete(tabId);
        const explicit = this.explicitOperations.get(tabId);
        if (explicit !== undefined) {
            this.settleExplicitOperation(explicit, null);
        }
        if (this.currentIntent?.tabId === tabId) {
            this.invalidateIntent(this.currentIntent);
        }
        if (this.awaitingUrlIntent?.tabId === tabId) {
            this.awaitingUrlIntent = null;
        }
        this.dependencies.discardFrame(tabId);
        await this.dependencies.associations.mutate(tabId, () => ({ kind: 'remove' }));
    }

    /**
     * Converts an orphaned pending projection left by a stopped worker into a
     * recoverable tab-aware error, yielding to any newer synchronization intent.
     */
    async normalizeStartupContent(): Promise<void> {
        await this.ensureInitialized();
        const stored = this.currentProjection;
        if (stored?.content.kind !== SIDE_PANEL_CONTENT_KIND.PENDING) {
            return;
        }
        const intent = this.beginRequest('manual', stored.content.tabId);
        await this.publish(intent, {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: stored.content.tabId,
            reason: HN_LOOKUP_STATUS.ERROR,
        }, true);
    }

    /**
     * Cancels unfinished work after this window loses its last live panel port.
     * A transient target is converted to manual-required after every older
     * projection write settles, while an already completed terminal projection
     * and every valid association remain untouched.
     */
    async disconnect(): Promise<void> {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        await this.ensureInitialized();
        this.expectedNavigations.clear();
        for (const explicit of [...this.explicitOperations.values()]) {
            this.settleExplicitOperation(explicit, null);
        }
        const activeIntent = this.currentIntent;
        const transientTabId = activeIntent?.tabId
            ?? (this.currentProjection?.content.kind === SIDE_PANEL_CONTENT_KIND.PENDING
                ? this.currentProjection.content.tabId
                : null);
        if (activeIntent !== null) {
            this.invalidateIntent(activeIntent);
        } else {
            this.awaitingUrlIntent = null;
            this.controller?.abort();
            this.controller = null;
        }
        const disconnectedGeneration = this.generation;
        await this.projectionQueue.catch(() => undefined);
        if (transientTabId === null
            || this.generation !== disconnectedGeneration
            || this.currentIntent !== null) {
            return;
        }
        const manual = this.beginRequest('manual', transientTabId);
        requireApplied(await this.publish(manual, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: transientTabId,
        }, true));
    }

    /**
     * Invalidates all in-flight and queued work when this window owner is removed.
     */
    discard(): void {
        this.advanceFollowAuthority('other');
        this.supersedeFollowActivations('other');
        this.expectedNavigations.clear();
        for (const explicit of this.explicitOperations.values()) {
            this.settleExplicitOperation(explicit, null);
        }
        this.explicitOperations.clear();
        this.awaitingUrlIntent = null;
        if (this.currentIntent !== null) {
            this.invalidateIntent(this.currentIntent);
            return;
        }
        this.controller?.abort();
        this.controller = null;
        this.generation += 1;
    }

    /**
     * Starts one hydrated explicit intent if its reservation is still newest.
     * @param controller - The internal reservation controller to start.
     */
    private startExplicitOperation(controller: ExplicitOperationController): void {
        if (this.explicitOperations.get(controller.tabId) !== controller
            || controller.token !== this.explicitOperationToken
            || controller.settled) {
            this.settleExplicitOperation(controller, null);
            return;
        }
        const intent = this.beginRequest('explicit', controller.tabId, controller);
        controller.intent = intent;
        controller.resolveStarted(intent);
    }

    /**
     * Finds one exact queued follow controller.
     * @param reservation - The public capture token to resolve.
     */
    private followActivationController(
        reservation: SidePanelFollowActivationToken,
    ): FollowActivationController | null {
        const controller = this.followActivations.get(reservation.token);
        return controller?.tabId === reservation.tabId ? controller : null;
    }

    /**
     * Advances the manager's trusted authority revision synchronously at a
     * browser or user-action boundary.
     * @param cause - Whether the newest boundary was a real activation or another action.
     */
    private advanceFollowAuthority(cause: 'activation' | 'other'): void {
        this.invalidateRecovery();
        this.followAuthorityToken += 1;
        this.followAuthorityCause = cause;
    }

    /**
     * Marks queued follow captures as superseded at a trusted synchronous
     * boundary. An optional tab restricts lifecycle cleanup to its own capture.
     * @param reason - Whether a genuine activation or another authority won.
     * @param tabId - The optional invalidated tab.
     */
    private supersedeFollowActivations(
        reason: FollowActivationController['supersededBy'],
        tabId?: number,
    ): void {
        for (const controller of this.followActivations.values()) {
            if (tabId !== undefined && controller.tabId !== tabId) {
                continue;
            }
            controller.supersededBy = reason;
            if (this.followActivation === controller) {
                this.followActivation = null;
            }
        }
    }

    /**
     * Converts a superseded capture into a stable continuation result, waiting
     * for a newer explicit operation's first projection when one is available.
     * @param controller - The capture whose newer authority is reported.
     */
    private async followSupersession(
        controller: FollowActivationController,
    ): Promise<SidePanelFollowContinuation> {
        if (this.wasFollowActivationSupersededByActivation(controller)) {
            return { kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED };
        }
        const authoritativeProjection = await this.newestManualOrExplicitProjection();
        if (this.wasFollowActivationSupersededByActivation(controller)) {
            return { kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED };
        }
        return {
            kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED,
            projection: authoritativeProjection ?? this.currentProjection,
        };
    }

    /**
     * Reports how a request-time setting authority was superseded.
     */
    private async followAuthoritySupersession(): Promise<SidePanelFollowContinuation> {
        if (this.wasFollowAuthoritySupersededByActivation()) {
            return { kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED };
        }
        const projection = await this.newestManualOrExplicitProjection()
            ?? this.currentProjection;
        if (this.wasFollowAuthoritySupersededByActivation()) {
            return { kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.ACTIVE_TAB_CHANGED };
        }
        return {
            kind: SIDE_PANEL_FOLLOW_CONTINUATION_KIND.SUPERSEDED,
            projection,
        };
    }

    /**
     * Waits for the newer explicit or Check operation that must remain visible.
     */
    private async newestManualOrExplicitProjection(): Promise<SidePanelProjection | null> {
        const explicit = [...this.explicitOperations.values()].at(-1);
        if (explicit !== undefined) {
            const projection = await explicit.reservation.readiness;
            if (projection !== null) {
                return projection;
            }
        }
        const manual = this.manualCheck;
        if (manual !== null) {
            try {
                return await manual;
            } catch {
                // A still-newer trusted boundary determines the result below.
            }
        }
        const replacementExplicit = [...this.explicitOperations.values()].at(-1);
        return replacementExplicit === undefined
            ? null
            : replacementExplicit.reservation.readiness;
    }

    /**
     * Reads the mutable follow-capture supersession cause without retaining a
     * stale control-flow narrowing across an awaited operation.
     * @param controller - The capture whose newest cause is inspected.
     */
    private wasFollowActivationSupersededByActivation(
        controller: FollowActivationController,
    ): boolean {
        return controller.supersededBy === 'activation';
    }

    /**
     * Reads the mutable setting-authority cause after awaited newer work settles.
     */
    private wasFollowAuthoritySupersededByActivation(): boolean {
        return this.followAuthorityCause === 'activation';
    }

    /**
     * Finds the exact controller represented by one public reservation.
     * @param reservation - The public reservation to resolve.
     */
    private explicitController(
        reservation: ExplicitOperationReservation,
    ): ExplicitOperationController | null {
        const controller = this.explicitOperations.get(reservation.tabId);
        return controller?.token === reservation.token ? controller : null;
    }

    /**
     * Resolves an explicit operation's first projection at most once.
     * @param controller - The explicit controller whose readiness settles.
     * @param projection - The first applied projection, or null on cancellation.
     */
    private settleExplicitReadiness(
        controller: ExplicitOperationController,
        projection: SidePanelProjection | null,
    ): void {
        if (controller.readinessSettled) {
            return;
        }
        controller.readinessSettled = true;
        controller.resolveReadiness(projection);
    }

    /**
     * Settles all remaining handles for one explicit operation exactly once.
     * @param controller - The explicit controller to settle.
     * @param projection - Its terminal projection, or null on cancellation.
     */
    private settleExplicitOperation(
        controller: ExplicitOperationController,
        projection: SidePanelProjection | null,
    ): void {
        if (controller.settled) {
            return;
        }
        controller.settled = true;
        if (this.explicitOperations.get(controller.tabId) === controller) {
            this.explicitOperations.delete(controller.tabId);
        }
        const expected = this.expectedNavigations.get(controller.tabId);
        if (expected?.pairedExplicitToken === controller.token) {
            if (projection === null || expected.matched) {
                this.expectedNavigations.delete(controller.tabId);
            } else {
                expected.pairedExplicitToken = null;
            }
        }
        controller.resolveStarted(controller.intent);
        this.settleExplicitReadiness(controller, projection);
        controller.resolveCompletion(projection);
    }

    /**
     * Consumes one exact expected navigation or fails the reservation closed on
     * the first unrelated URL-bearing event.
     * @param tabId - The tab reporting navigation.
     * @param reportedUrl - The exact browser-reported URL.
     */
    private consumeExpectedNavigation(
        tabId: number,
        reportedUrl: string,
    ): ExpectedNavigationMatch {
        const expected = this.expectedNavigations.get(tabId);
        if (expected === undefined) {
            return EXPECTED_NAVIGATION_MATCH.NONE;
        }
        const matchesRawUrl = reportedUrl === expected.rawUrl;
        const reportedIdentity = matchesRawUrl
            ? expected.articleIdentity
            : this.dependencies.normalizeArticleUrl(reportedUrl);
        const matchesIdentity = expected.articleIdentity !== null
            && reportedIdentity === expected.articleIdentity;
        if (matchesRawUrl || matchesIdentity) {
            if (expected.pairedExplicitToken === null) {
                this.expectedNavigations.delete(tabId);
            } else {
                expected.matched = true;
            }
            return EXPECTED_NAVIGATION_MATCH.MATCHED;
        }
        this.expectedNavigations.delete(tabId);
        return EXPECTED_NAVIGATION_MATCH.MISMATCHED;
    }

    /**
     * Completes navigation and lookup for one concrete context-menu operation.
     * @param tabId - The explicitly targeted tab.
     * @param targetUrl - The exact selected link target.
     * @param expected - The optional exact navigation expectation.
     * @param explicit - The explicit operation reservation.
     */
    private async completeOpenLink(
        tabId: number,
        targetUrl: string,
        expected: ExpectedNavigationReservation | null,
        explicit: ExplicitOperationReservation,
    ): Promise<SidePanelProjection> {
        try {
            const ready = await this.prepareExplicitOperation(explicit);
            if (ready === null) {
                throw supersededIntentError();
            }
            if (isWebUrl(targetUrl)) {
                await this.dependencies.navigate(tabId, targetUrl);
            }
            const controller = this.explicitController(explicit);
            const intent = await controller?.started;
            if (controller === null || controller === undefined || intent == null) {
                throw supersededIntentError();
            }
            return await this.resolveUrl(
                intent,
                targetUrl,
                SIDE_PANEL_ASSOCIATION_ORIGIN.EXPLICIT,
                controller,
            );
        } catch (error) {
            if (expected !== null) {
                this.cancelExpectedNavigation(expected);
            }
            this.cancelExplicitOperation(explicit, true);
            throw error;
        }
    }

    /**
     * Persists one reusable association through the process-wide FIFO while
     * preserving any newer association already owned by another window.
     * @param association - The association to commit when ownership still holds.
     */
    private async persistAssociation(association: SidePanelAssociation): Promise<void> {
        await this.dependencies.associations.mutate(
            association.tabId,
            async (current) => {
                if (await this.tabBelongsToWindow(association.tabId)) {
                    return { kind: 'set', association };
                }
                return current?.windowId === this.windowId
                    ? { kind: 'remove' }
                    : { kind: 'keep' };
            },
        ).catch(() => {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED, {
                tabId: association.tabId,
            });
        });
    }

    /**
     * Starts best-effort live-window recovery after an explicit target cancels.
     */
    private resynchronize(): void {
        const authority = this.reserveRecoveryAuthority();
        void this.dependencies.resynchronize(authority).catch(() => {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED, {});
        });
    }

    /**
     * Creates one opaque recovery attempt and aborts any older attempt that has
     * not crossed its final manager-owned authority check yet.
     */
    private reserveRecoveryAuthority(): SidePanelRecoveryAuthority {
        this.invalidateRecovery();
        const controller = new AbortController();
        this.recoveryController = controller;
        this.recoveryToken += 1;
        return {
            token: this.recoveryToken,
            signal: controller.signal,
        };
    }

    /**
     * Cancels an unfinished recovery at every newer trusted manager boundary.
     */
    private invalidateRecovery(): void {
        this.recoveryController?.abort();
        this.recoveryController = null;
    }

    /**
     * Checks one recovery immediately before it may allocate visible authority.
     * @param authority - The opaque recovery attempt returning from browser work.
     */
    private isRecoveryCurrent(authority: SidePanelRecoveryAuthority): boolean {
        return !authority.signal.aborted
            && authority.token === this.recoveryToken
            && this.recoveryController?.signal === authority.signal;
    }

    /**
     * Coalesces projection hydration and seeds revision allocation from session
     * storage so a restarted worker can never reuse an observed revision.
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialization === null) {
            this.initialization = this.dependencies.readProjection().then((stored) => {
                if (stored !== null) {
                    this.currentProjection = stored;
                    this.nextProjectionRevision = Math.max(
                        this.nextProjectionRevision,
                        stored.revision,
                    );
                }
            });
        }
        await this.initialization;
    }

    /**
     * Reserves a new target synchronously after hydration and invalidates older work.
     * @param cause - The authority that permits the new operation.
     * @param tabId - The tab targeted by the operation.
     * @param protectedExplicit - The controller currently installing its intent.
     */
    private beginRequest(
        cause: SynchronizationIntent['cause'],
        tabId: number,
        protectedExplicit?: ExplicitOperationController,
    ): SynchronizationIntent {
        for (const explicit of this.explicitOperations.values()) {
            if (explicit !== protectedExplicit) {
                this.settleExplicitOperation(explicit, null);
            }
        }
        if (this.currentIntent !== null) {
            this.invalidateIntent(this.currentIntent);
        } else {
            this.controller?.abort();
            this.controller = null;
        }
        const intent: SynchronizationIntent = {
            generation: this.generation + 1,
            cause,
            tabId,
            firstProjectionRevision: this.reserveProjectionRevision(),
            hasPublished: false,
        };
        this.generation = intent.generation;
        this.currentIntent = intent;
        this.dependencies.target(tabId, intent.firstProjectionRevision);
        return intent;
    }

    /**
     * Allocates one manager-local revision after its hydrated high-water mark.
     */
    private reserveProjectionRevision(): number {
        this.nextProjectionRevision += 1;
        return this.nextProjectionRevision;
    }

    /**
     * Determines whether one intent still owns visible state.
     * @param intent - The intent whose authority is checked.
     */
    private isCurrent(intent: SynchronizationIntent): boolean {
        return this.currentIntent === intent;
    }

    /**
     * Throws the standard abort when one intent has been superseded.
     * @param intent - The intent required to still be current.
     */
    private requireCurrent(intent: SynchronizationIntent): void {
        if (!this.isCurrent(intent)) {
            throw supersededIntentError();
        }
    }

    /**
     * Cancels lookup and visible-state authority for one exact intent.
     * @param intent - The current intent to invalidate.
     */
    private invalidateIntent(intent: SynchronizationIntent): void {
        if (!this.isCurrent(intent)) {
            return;
        }
        if (this.awaitingUrlIntent === intent) {
            this.awaitingUrlIntent = null;
        }
        this.controller?.abort();
        this.controller = null;
        this.currentIntent = null;
        this.generation += 1;
        const explicit = this.explicitOperations.get(intent.tabId);
        if (explicit?.intent === intent) {
            this.settleExplicitOperation(explicit, null);
        }
    }

    /**
     * Queues one revisioned projection and applies it only while its intent is
     * current. Terminal writes release intent authority atomically with commit.
     * @param intent - The synchronization intent that owns the projection.
     * @param content - The tab-aware content to persist.
     * @param terminal - Whether successful commit completes the intent.
     */
    private async publish(
        intent: SynchronizationIntent,
        content: SidePanelContent,
        terminal = false,
    ): Promise<SidePanelProjection | null> {
        let applied: SidePanelProjection | null = null;
        const revision = intent.hasPublished
            ? this.reserveProjectionRevision()
            : intent.firstProjectionRevision;
        intent.hasPublished = true;
        const operation = this.projectionQueue.catch(() => undefined).then(async () => {
            if (!this.isCurrent(intent)) {
                return;
            }
            if (terminal) {
                const owned = await this.tabBelongsToWindow(intent.tabId);
                if (!this.isCurrent(intent)) {
                    return;
                }
                if (!owned) {
                    if (this.awaitingUrlIntent === intent) {
                        this.awaitingUrlIntent = null;
                    }
                    this.controller?.abort();
                    this.controller = null;
                    this.currentIntent = null;
                    this.generation += 1;
                    return;
                }
            }
            const nextProjection: SidePanelProjection = { revision, content };
            await this.dependencies.writeProjection(nextProjection);
            if (!this.isCurrent(intent)) {
                return;
            }
            this.currentProjection = nextProjection;
            applied = nextProjection;
            if (terminal) {
                this.currentIntent = null;
            }
        });
        this.projectionQueue = operation;
        await operation;
        return applied;
    }

    /**
     * Reads a settled association while treating storage failure as a safe miss.
     * @param tabId - The tab whose reusable association is read.
     */
    private async readAssociation(tabId: number): Promise<SidePanelAssociation | null> {
        try {
            return await this.dependencies.associations.settledGet(tabId);
        } catch {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED, { tabId });
            return null;
        }
    }

    /**
     * Resolves one consented URL, publishes its terminal outcome, and only then
     * queues reusable association persistence through the process-wide FIFO.
     * @param intent - The synchronization intent owning this lookup.
     * @param url - The consented page URL to resolve.
     * @param origin - The authority recorded with a reusable association.
     * @param explicit - The optional explicit controller settled on completion.
     */
    private async resolveUrl(
        intent: SynchronizationIntent,
        url: string,
        origin: SidePanelAssociationOrigin,
        explicit?: ExplicitOperationController,
    ): Promise<SidePanelProjection> {
        const controller = new AbortController();
        this.controller = controller;
        let lookup: PanelLookupResult;
        try {
            lookup = await this.dependencies.lookup(url, controller.signal);
        } catch {
            this.requireCurrent(intent);
            this.warn(FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED, { tabId: intent.tabId });
            lookup = {
                result: {
                    status: HN_LOOKUP_STATUS.ERROR,
                    reason: HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED,
                },
                articleIdentity: null,
            };
        } finally {
            if (this.controller === controller) {
                this.controller = null;
            }
        }
        this.requireCurrent(intent);
        await this.requireTabOwnership(intent);
        const content = contentForLookupResult(lookup.result, intent.tabId);
        const result = requireApplied(await this.publish(intent, content, true));
        if (explicit !== undefined) {
            this.settleExplicitReadiness(explicit, result);
        }
        let outcome: SidePanelAssociation['outcome'];
        if (content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION) {
            outcome = { kind: content.kind, itemId: content.itemId };
        } else if (content.kind === SIDE_PANEL_CONTENT_KIND.UNAVAILABLE
            && content.reason !== HN_LOOKUP_STATUS.ERROR) {
            outcome = { kind: content.kind, reason: content.reason };
        } else {
            if (explicit !== undefined) {
                this.settleExplicitOperation(explicit, result);
            }
            return result;
        }
        const association: SidePanelAssociation = {
            tabId: intent.tabId,
            windowId: this.windowId,
            origin,
            outcome,
            articleIdentity: lookup.articleIdentity,
        };
        await this.persistAssociation(association);
        if (explicit !== undefined) {
            this.settleExplicitOperation(explicit, result);
        }
        return result;
    }

    /**
     * Verifies that one tab still belongs to this manager immediately before a
     * terminal projection or association can be committed.
     * @param intent - The intent whose tab ownership is checked.
     */
    private async requireTabOwnership(intent: SynchronizationIntent): Promise<void> {
        const owned = await this.tabBelongsToWindow(intent.tabId);
        this.requireCurrent(intent);
        if (!owned) {
            this.invalidateIntent(intent);
            throw supersededIntentError();
        }
    }

    /**
     * Reads tab ownership without acquiring or exposing the tab URL.
     * @param tabId - The tab whose current browser window is checked.
     */
    private async tabBelongsToWindow(tabId: number): Promise<boolean> {
        try {
            return await this.dependencies.getTabWindow(tabId) === this.windowId;
        } catch {
            this.warn(FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED, { tabId });
            return false;
        }
    }

    /**
     * Emits one manager warning with its fixed window identifier.
     * @param code - The stable allow-listed warning code.
     * @param details - Optional tab identifiers for this manager operation.
     */
    private warn(
        code: Parameters<FollowWarningSink>[0],
        details: Readonly<Omit<FollowDiagnosticDetails, 'code' | 'windowId'>>,
    ): void {
        this.dependencies.warn(code, { ...details, windowId: this.windowId });
    }
}

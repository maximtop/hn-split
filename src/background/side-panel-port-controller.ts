import type { SidePanelFraming } from './side-panel-framing';
import type { SidePanelWindowRegistry } from '../browser/side-panel-window-registry';
import {
    SIDE_PANEL_CONTEXT,
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    SIDE_PANEL_RESET,
    isSidePanelPortMessage,
} from '../shared/messages';
import { FOLLOW_DIAGNOSTIC_CODE } from '../shared/logger';
import type { FollowWarningSink } from '../shared/logger';
import type { SidePanelReadyStamp } from '../shared/side-panel-projection';

const FRAMING_ACQUISITION_FAILED_MESSAGE = 'Side panel framing acquisition failed';

/**
 * Defines framing, live-window, synchronization, and diagnostic operations for
 * the side-panel port lifecycle.
 */
export interface SidePanelPortControllerDependencies {
    /**
     * Owns the ref-counted Hacker News framing exception.
     */
    framing: Pick<SidePanelFraming, 'acquire' | 'release'>;
    /**
     * Contains the browser-issued identifier of this extension.
     */
    sidePanelExtensionId: string;
    /**
     * Contains the exact browser-issued URL of the trusted side-panel document.
     */
    sidePanelDocumentUrl: string;
    /**
     * Tracks every validated panel port by browser window.
     */
    windows: SidePanelWindowRegistry;
    /**
     * Synchronizes the tab active in one framed panel window.
     * @param windowId - The browser window to synchronize.
     */
    connectWindow(windowId: number): Promise<SidePanelReadyStamp>;
    /**
     * Cancels unfinished panel work after one window loses its last port.
     * @param windowId - The disconnected browser window.
     */
    disconnectWindow(windowId: number): Promise<void>;
    /**
     * Reports one allow-listed lifecycle failure without page data.
     */
    warn: FollowWarningSink;
}

/**
 * Determines whether an initialization failure represents ordinary newest-wins
 * cancellation rather than an operational failure.
 * @param value - The caught initialization failure.
 */
function isAbortError(value: unknown): boolean {
    return value instanceof DOMException && value.name === 'AbortError';
}

/**
 * Binds each side-panel port to exactly one validated window context, orders
 * RESET/framing/synchronization/READY, and keeps overlapping reconnects safe.
 */
export class SidePanelPortController {
    private readonly generations = new Map<number, number>();

    private readonly initializingGenerations = new Map<number, number>();

    private readonly pendingRecoveries = new Set<number>();

    private readonly signaledRecoveries = new Map<number, number>();

    /**
     * Creates the port controller.
     * @param dependencies - Framing, registry, synchronization, and warning boundaries.
     */
    constructor(private readonly dependencies: SidePanelPortControllerDependencies) {}

    /**
     * Accepts one named side-panel port and waits for its first valid context.
     * @param port - The Chrome runtime port opened by the panel document.
     */
    accept(port: chrome.runtime.Port): void {
        if (port.name !== SIDE_PANEL_PORT
            || port.sender?.id !== this.dependencies.sidePanelExtensionId
            || port.sender?.url !== this.dependencies.sidePanelDocumentUrl) {
            return;
        }
        let connected = true;
        let windowId: number | null = null;
        let unregister: (() => void) | null = null;
        let framing: Promise<void> | null = null;

        port.onMessage.addListener((value: unknown) => {
            if (!connected || windowId !== null || !isSidePanelPortMessage(value)
                || value.type !== SIDE_PANEL_CONTEXT) {
                return;
            }
            windowId = value.windowId;
            framing = this.dependencies.framing.acquire().catch(() => {
                this.dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.FRAMING_ACQUIRE_FAILED, {});
                throw new Error(FRAMING_ACQUISITION_FAILED_MESSAGE);
            });
            void framing.catch(() => undefined);
            unregister = this.dependencies.windows.register(windowId, port, framing);
            void this.reinitialize(windowId);
        });

        port.onDisconnect.addListener(() => {
            if (!connected) {
                return;
            }
            connected = false;
            const disconnectedWindowId = windowId;
            unregister?.();
            unregister = null;
            if (disconnectedWindowId !== null) {
                if (this.dependencies.windows.has(disconnectedWindowId)) {
                    void this.reinitialize(disconnectedWindowId);
                } else {
                    this.nextGeneration(disconnectedWindowId);
                    this.initializingGenerations.delete(disconnectedWindowId);
                    this.pendingRecoveries.delete(disconnectedWindowId);
                    this.signaledRecoveries.delete(disconnectedWindowId);
                    void this.dependencies.disconnectWindow(disconnectedWindowId).catch(() => {
                        this.dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.DISCONNECT_FAILED, {
                            windowId: disconnectedWindowId,
                        });
                    });
                }
            }
            if (framing !== null) {
                void this.dependencies.framing.release().catch(() => {
                    this.dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.FRAMING_RELEASE_FAILED, {});
                });
            }
        });
    }

    /**
     * Retries one failed initial synchronization after an authoritative tab
     * event has itself synchronized successfully. Repeated or unrelated events
     * are ignored instead of polling for an active tab.
     * @param windowId - The live panel window eligible for recovery.
     */
    recoverWindow(windowId: number): void {
        if (!this.dependencies.windows.has(windowId)) {
            this.pendingRecoveries.delete(windowId);
            this.signaledRecoveries.delete(windowId);
            return;
        }
        if (this.pendingRecoveries.delete(windowId)) {
            void this.reinitialize(windowId);
            return;
        }
        const generation = this.initializingGenerations.get(windowId);
        if (generation !== undefined && this.generations.get(windowId) === generation) {
            this.signaledRecoveries.set(windowId, generation);
        }
    }

    /**
     * Allocates the next initialization generation for one panel window.
     * @param windowId - The browser window whose generation advances.
     */
    private nextGeneration(windowId: number): number {
        const generation = (this.generations.get(windowId) ?? 0) + 1;
        this.generations.set(windowId, generation);
        return generation;
    }

    /**
     * Clears in-flight and early recovery markers only when they still belong
     * to the specified initialization generation.
     * @param windowId - The panel window whose markers may be cleared.
     * @param generation - The initialization generation being settled.
     */
    private clearInitialization(windowId: number, generation: number): void {
        if (this.initializingGenerations.get(windowId) === generation) {
            this.initializingGenerations.delete(windowId);
        }
        if (this.signaledRecoveries.get(windowId) === generation) {
            this.signaledRecoveries.delete(windowId);
        }
    }

    /**
     * Resets retained UI immediately, waits for framing, then publishes READY
     * only for the newest successfully synchronized active tab.
     * @param windowId - The live panel window to reinitialize.
     */
    private async reinitialize(windowId: number): Promise<void> {
        const generation = this.nextGeneration(windowId);
        this.pendingRecoveries.delete(windowId);
        this.signaledRecoveries.delete(windowId);
        this.initializingGenerations.set(windowId, generation);
        this.dependencies.windows.broadcast(windowId, { type: SIDE_PANEL_RESET });
        try {
            await this.dependencies.windows.waitUntilFramed(windowId);
        } catch {
            this.clearInitialization(windowId, generation);
            if (this.dependencies.windows.has(windowId)) {
                this.dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED, { windowId });
            }
            return;
        }
        while (this.generations.get(windowId) === generation
            && this.dependencies.windows.has(windowId)) {
            try {
                const stamp = await this.dependencies.connectWindow(windowId);
                this.clearInitialization(windowId, generation);
                if (this.generations.get(windowId) === generation
                    && this.dependencies.windows.has(windowId)) {
                    this.dependencies.windows.broadcast(windowId, {
                        type: SIDE_PANEL_READY,
                        tabId: stamp.tabId,
                        projectionRevision: stamp.projectionRevision,
                    });
                }
                return;
            } catch (error) {
                if (isAbortError(error)) {
                    if (this.signaledRecoveries.get(windowId) === generation) {
                        this.signaledRecoveries.delete(windowId);
                    }
                    continue;
                }
                const recoverySignaled = this.signaledRecoveries.get(windowId) === generation;
                this.clearInitialization(windowId, generation);
                if (this.generations.get(windowId) === generation
                    && this.dependencies.windows.has(windowId)) {
                    this.dependencies.warn(
                        FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED,
                        { windowId },
                    );
                    if (recoverySignaled) {
                        void this.reinitialize(windowId);
                    } else {
                        this.pendingRecoveries.add(windowId);
                    }
                }
                return;
            }
        }
        this.clearInitialization(windowId, generation);
    }
}

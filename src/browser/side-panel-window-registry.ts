import {
    SIDE_PANEL_DISCARD_TAB,
} from '../shared/messages';
import type { SidePanelPortMessage } from '../shared/messages';

/**
 * Describes the only port operation needed by the live-window registry.
 */
export interface SidePanelPortClient {
    /**
     * Sends one validated lifecycle message to the side-panel document.
     * @param message - The strict lifecycle message to deliver.
     */
    postMessage(message: SidePanelPortMessage): void;
}

/**
 * Tracks every live side-panel port by its owning browser window. Overlapping
 * documents use set semantics so one reconnect cannot make another live port
 * disappear prematurely.
 */
export class SidePanelWindowRegistry {
    private readonly ports = new Map<
        number,
        Map<SidePanelPortClient, Promise<void>>
    >();

    /**
     * Registers one panel port and its framing-readiness barrier.
     * @param windowId - The browser window that owns the panel document.
     * @param port - The live panel port to retain.
     * @param framed - The framing acquisition associated with this port.
     */
    register(
        windowId: number,
        port: SidePanelPortClient,
        framed: Promise<void>,
    ): () => void {
        const ports = this.ports.get(windowId)
            ?? new Map<SidePanelPortClient, Promise<void>>();
        ports.set(port, framed);
        this.ports.set(windowId, ports);
        let registered = true;
        return () => {
            if (!registered) {
                return;
            }
            registered = false;
            ports.delete(port);
            if (ports.size === 0) {
                this.ports.delete(windowId);
            }
        };
    }

    /**
     * Determines whether one window still owns at least one live panel port.
     * @param windowId - The browser window to inspect.
     */
    has(windowId: number): boolean {
        return (this.ports.get(windowId)?.size ?? 0) > 0;
    }

    /**
     * Lists every window currently represented by a live panel port.
     */
    windowIds(): number[] {
        return [...this.ports.keys()];
    }

    /**
     * Waits for every port currently registered to one window to acquire the
     * shared framing exception.
     * @param windowId - The browser window whose framing barriers are awaited.
     */
    async waitUntilFramed(windowId: number): Promise<void> {
        const framed = [...(this.ports.get(windowId)?.values() ?? [])];
        await Promise.all(framed);
    }

    /**
     * Destroys retained discussion contexts for one tab in its owning window.
     * @param windowId - The panel window receiving the invalidation.
     * @param tabId - The tab whose retained discussion contexts are discarded.
     */
    discardTab(windowId: number, tabId: number): void {
        this.broadcast(windowId, { type: SIDE_PANEL_DISCARD_TAB, tabId });
    }

    /**
     * Delivers one lifecycle message to every live port in one window. A stale
     * throwing port is pruned without preventing surviving documents from
     * receiving the same message.
     * @param windowId - The browser window whose ports receive the message.
     * @param message - The strict lifecycle message to broadcast.
     */
    broadcast(windowId: number, message: SidePanelPortMessage): void {
        const ports = this.ports.get(windowId);
        if (ports === undefined) {
            return;
        }
        for (const port of [...ports.keys()]) {
            try {
                port.postMessage(message);
            } catch {
                ports.delete(port);
            }
        }
        if (ports.size === 0) {
            this.ports.delete(windowId);
        }
    }
}

import { describe, expect, it, vi } from 'vitest';

import { SidePanelWindowRegistry } from '../src/browser/side-panel-window-registry';
import type { SidePanelPortClient } from '../src/browser/side-panel-window-registry';
import {
    SIDE_PANEL_DISCARD_TAB,
    SIDE_PANEL_RESET,
} from '../src/shared/messages';
import type { SidePanelPortMessage } from '../src/shared/messages';

const WINDOW_ID = 3;
const OTHER_WINDOW_ID = 4;
const TAB_ID = 7;

/**
 * Builds one observable port client.
 */
function client(): SidePanelPortClient & {
    postMessage: ReturnType<typeof vi.fn<(message: SidePanelPortMessage) => void>>;
} {
    return { postMessage: vi.fn<(message: SidePanelPortMessage) => void>() };
}

describe('SidePanelWindowRegistry', () => {
    it('keeps a window live until its last overlapping port disconnects', () => {
        const registry = new SidePanelWindowRegistry();
        const first = client();
        const second = client();
        const releaseFirst = registry.register(WINDOW_ID, first, Promise.resolve());
        const releaseSecond = registry.register(WINDOW_ID, second, Promise.resolve());

        releaseFirst();
        expect(registry.has(WINDOW_ID)).toBe(true);
        expect(registry.windowIds()).toEqual([WINDOW_ID]);

        releaseSecond();
        expect(registry.has(WINDOW_ID)).toBe(false);
        expect(registry.windowIds()).toEqual([]);
    });

    it('publishes frame invalidation only to the owning window', () => {
        const registry = new SidePanelWindowRegistry();
        const first = client();
        const second = client();
        registry.register(WINDOW_ID, first, Promise.resolve());
        registry.register(OTHER_WINDOW_ID, second, Promise.resolve());

        registry.discardTab(WINDOW_ID, TAB_ID);

        expect(first.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: SIDE_PANEL_DISCARD_TAB,
            tabId: TAB_ID,
        });
        expect(second.postMessage).not.toHaveBeenCalled();
    });

    it('delivers lifecycle messages to surviving ports when one stale port throws', () => {
        const registry = new SidePanelWindowRegistry();
        const stale = client();
        const live = client();
        stale.postMessage.mockImplementation(() => {
            throw new Error('disconnected');
        });
        registry.register(WINDOW_ID, stale, Promise.resolve());
        registry.register(WINDOW_ID, live, Promise.resolve());

        expect(() => registry.broadcast(WINDOW_ID, { type: SIDE_PANEL_RESET })).not.toThrow();

        expect(live.postMessage).toHaveBeenCalledExactlyOnceWith({ type: SIDE_PANEL_RESET });
        expect(registry.has(WINDOW_ID)).toBe(true);
    });

    it('waits for every currently registered framing acquisition', async () => {
        let resolveFirst: () => void = () => undefined;
        let resolveSecond: () => void = () => undefined;
        const firstFramed = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const secondFramed = new Promise<void>((resolve) => {
            resolveSecond = resolve;
        });
        const registry = new SidePanelWindowRegistry();
        registry.register(WINDOW_ID, client(), firstFramed);
        registry.register(WINDOW_ID, client(), secondFramed);
        let settled = false;
        const framed = registry.waitUntilFramed(WINDOW_ID).then(() => {
            settled = true;
        });

        resolveFirst();
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveSecond();
        await framed;
        expect(settled).toBe(true);
    });
});

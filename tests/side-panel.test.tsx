import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };
import { SidePanelApp } from '../src/side-panel/side-panel-app';
import { discussionUrl } from '../src/domain/hn';
import {
    BACKGROUND_REQUEST_TYPE,
    SIDE_PANEL_KEEPALIVE,
    SIDE_PANEL_KEEPALIVE_INTERVAL_MS,
    SIDE_PANEL_READY,
    SIDE_PANEL_RECONNECT_DELAY_MS,
} from '../src/shared/messages';
import type { SidePanelContent } from '../src/shared/side-panel-content';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM_ID = '424242';
const WINDOW_ID = 3;

/**
 * Exposes one connected runtime port from the Chrome double.
 */
interface FakePort {
    /**
     * Delivers one background message to the panel's port listener.
     */
    emitMessage: (message: { type: string }) => void;
    /**
     * Reports that the background disconnected this port.
     */
    emitDisconnect: () => void;
    /**
     * Records every message the panel sends through its long-lived port.
     */
    postMessage: ReturnType<typeof vi.fn>;
    /**
     * Records when the panel disconnects its long-lived port.
     */
    disconnect: ReturnType<typeof vi.fn>;
}

/**
 * Exposes the seams of the installed Chrome double.
 */
interface FakeChrome {
    /**
     * Contains every port created by runtime.connect, in connection order.
     */
    ports: FakePort[];
    /**
     * Records every runtime request the panel sends.
     */
    sendMessage: ReturnType<typeof vi.fn>;
}

/**
 * Configures exceptional behavior in the installed Chrome double.
 */
interface FakeChromeOptions {
    /**
     * Selects the zero-based port whose first postMessage call throws.
     */
    failInitialPostMessageForPort?: number;
}

/**
 * Installs a Chrome double that answers with one panel content value and
 * creates an independently controllable port for every connection attempt.
 * @param content - The content the background worker reports.
 * @param options - Exceptional port behavior to simulate.
 */
function installChrome(content: SidePanelContent | null, options: FakeChromeOptions = {}): FakeChrome {
    const ports: FakePort[] = [];
    const sendMessage = vi.fn(async () => ({ ok: true, result: { content } }));
    vi.stubGlobal('chrome', {
        runtime: {
            connect: vi.fn(() => {
                const messageListeners: Array<(message: { type: string }) => void> = [];
                const disconnectListeners: Array<() => void> = [];
                const portIndex = ports.length;
                let postMessageAttempts = 0;
                const postMessage = vi.fn(() => {
                    postMessageAttempts += 1;
                    if (options.failInitialPostMessageForPort === portIndex && postMessageAttempts === 1) {
                        throw new Error('The port disconnected before the message was sent');
                    }
                });
                const disconnect = vi.fn();
                const fakePort: FakePort = {
                    emitMessage: (message) => {
                        for (const listener of messageListeners) {
                            listener(message);
                        }
                    },
                    emitDisconnect: () => {
                        for (const listener of disconnectListeners) {
                            listener();
                        }
                    },
                    postMessage,
                    disconnect,
                };
                ports.push(fakePort);
                return {
                    onMessage: {
                        addListener: (listener: (message: { type: string }) => void) => messageListeners.push(listener),
                    },
                    onDisconnect: {
                        addListener: (listener: () => void) => disconnectListeners.push(listener),
                    },
                    postMessage,
                    disconnect,
                };
            }),
            sendMessage,
        },
        storage: {
            session: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
        },
        windows: {
            getCurrent: vi.fn(async () => ({ id: WINDOW_ID })),
        },
    });
    return {
        ports,
        sendMessage,
    };
}

/**
 * Returns one connected fake port or fails with a useful test error.
 * @param fake - The installed Chrome double.
 * @param index - The zero-based connection index to return.
 */
function requirePort(fake: FakeChrome, index: number): FakePort {
    const port = fake.ports[index];
    if (port === undefined) {
        throw new Error(`Expected fake port ${index} to be connected`);
    }
    return port;
}

async function renderPanel(): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<SidePanelApp />);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return {
        container,
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('SidePanelApp', () => {
    it.each([
        { name: 'nothing is selected', content: null, message: enMessages.side_panel_empty.message },
        { name: 'a lookup is running', content: { kind: 'pending' }, message: enMessages.side_panel_pending.message },
        {
            name: 'no discussion exists',
            content: { kind: 'unavailable', reason: 'not_found' },
            message: enMessages.discussion_not_found.message,
        },
        {
            name: 'the link is not eligible',
            content: { kind: 'unavailable', reason: 'restricted' },
            message: enMessages.restricted_page.message,
        },
        {
            name: 'the lookup failed',
            content: { kind: 'unavailable', reason: 'error' },
            message: enMessages.lookup_error.message,
        },
    ])('explains in a live region that $name', async ({ content, message }) => {
        installChrome(content as SidePanelContent | null);

        const panel = await renderPanel();

        expect(panel.container.querySelector('[role="status"]')?.textContent).toContain(message);
        expect(panel.container.querySelector('iframe')).toBeNull();
        await panel.unmount();
    });

    it('asks the background for its own window\'s selection', async () => {
        const fake = installChrome({ kind: 'discussion', itemId: ITEM_ID });

        const panel = await renderPanel();

        expect(fake.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
            windowId: WINDOW_ID,
        });
        await panel.unmount();
    });

    it('frames the discussion only once the framing exception is confirmed', async () => {
        const fake = installChrome({ kind: 'discussion', itemId: ITEM_ID });

        const panel = await renderPanel();

        // The exception must be installed before the frame is created, so the
        // panel waits for the worker's ready signal.
        expect(panel.container.querySelector('iframe')).toBeNull();
        await act(async () => {
            requirePort(fake, 0).emitMessage({ type: SIDE_PANEL_READY });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(panel.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_ID));
        await panel.unmount();
    });

    it('keeps the worker active only while the side panel stays mounted', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const fake = installChrome(null);

        const panel = await renderPanel();
        const port = requirePort(fake, 0);

        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: SIDE_PANEL_KEEPALIVE });
        await act(async () => {
            vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        });
        expect(port.postMessage).toHaveBeenCalledTimes(3);

        await panel.unmount();
        vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        expect(port.postMessage).toHaveBeenCalledTimes(3);
        expect(port.disconnect).toHaveBeenCalledOnce();
    });

    it('hides the frame and waits for a replacement port to become ready after disconnect', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const fake = installChrome({ kind: 'discussion', itemId: ITEM_ID });
        const panel = await renderPanel();
        const firstPort = requirePort(fake, 0);
        await act(async () => {
            firstPort.emitMessage({ type: SIDE_PANEL_READY });
        });
        expect(panel.container.querySelector('iframe')).not.toBeNull();

        await act(async () => {
            firstPort.emitDisconnect();
        });
        expect(panel.container.querySelector('iframe')).toBeNull();
        vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        expect(firstPort.postMessage).toHaveBeenCalledOnce();

        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, SIDE_PANEL_RECONNECT_DELAY_MS + 25));
        });
        const replacementPort = requirePort(fake, 1);
        expect(replacementPort.postMessage).toHaveBeenCalledExactlyOnceWith({ type: SIDE_PANEL_KEEPALIVE });
        expect(panel.container.querySelector('iframe')).toBeNull();
        await act(async () => {
            replacementPort.emitMessage({ type: SIDE_PANEL_READY });
        });
        expect(panel.container.querySelector('iframe')).not.toBeNull();

        await act(async () => {
            replacementPort.emitDisconnect();
        });
        await panel.unmount();
        vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        await new Promise((resolve) => window.setTimeout(resolve, SIDE_PANEL_RECONNECT_DELAY_MS + 25));
        expect(replacementPort.postMessage).toHaveBeenCalledOnce();
        expect(fake.ports).toHaveLength(2);
    });

    it('does not orphan a heartbeat timer when the initial message fails', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fake = installChrome(null, { failInitialPostMessageForPort: 0 });
        const panel = await renderPanel();
        const failedPort = requirePort(fake, 0);

        vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        expect(failedPort.postMessage).toHaveBeenCalledOnce();
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, SIDE_PANEL_RECONNECT_DELAY_MS + 25));
        });
        const replacementPort = requirePort(fake, 1);
        expect(replacementPort.postMessage).toHaveBeenCalledExactlyOnceWith({ type: SIDE_PANEL_KEEPALIVE });

        await panel.unmount();
        vi.advanceTimersByTime(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        await new Promise((resolve) => window.setTimeout(resolve, SIDE_PANEL_RECONNECT_DELAY_MS + 25));
        expect(replacementPort.postMessage).toHaveBeenCalledOnce();
        expect(fake.ports).toHaveLength(2);
    });
});

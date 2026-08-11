import { describe, expect, it, vi } from 'vitest';

import { SidePanelPortController } from '../src/background/side-panel-port-controller';
import type { SidePanelPortControllerDependencies } from '../src/background/side-panel-port-controller';
import {
    SIDE_PANEL_FRAMING_RULE_ID,
    SidePanelFraming,
    framingRule,
} from '../src/background/side-panel-framing';
import { SidePanelWindowRegistry } from '../src/browser/side-panel-window-registry';
import {
    SIDE_PANEL_CONTEXT,
    SIDE_PANEL_KEEPALIVE,
    SIDE_PANEL_PORT,
    SIDE_PANEL_READY,
    SIDE_PANEL_RESET,
    isSidePanelPortMessage,
} from '../src/shared/messages';

const WINDOW_ID = 3;
const OTHER_WINDOW_ID = 4;
const TAB_ID = 7;
const OTHER_TAB_ID = 8;
const EXTENSION_ID = 'extension-id';
const SIDE_PANEL_DOCUMENT_URL = 'chrome-extension://extension-id/side-panel.html';
const POPUP_DOCUMENT_URL = 'chrome-extension://extension-id/popup.html';

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve(value: Value): void;
    reject(reason: unknown): void;
}

interface FakePort {
    port: chrome.runtime.Port;
    postMessage: ReturnType<typeof vi.fn>;
    receive(value: unknown): void;
    disconnect(): void;
}

interface FakePortOptions {
    name?: string;
    senderId?: string | null;
    senderUrl?: string | null;
}

/**
 * Creates a manually settled promise.
 */
function deferred<Value>(): Deferred<Value> {
    let resolve: (value: Value) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

/**
 * Flushes queued promise continuations without relying on a real timer.
 */
async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Builds an observable Chrome-port double.
 */
function fakePort(options: Readonly<FakePortOptions> = {}): FakePort {
    const messageListeners: Array<(message: unknown) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    const postMessage = vi.fn();
    const senderUrl = options.senderUrl === undefined
        ? SIDE_PANEL_DOCUMENT_URL
        : options.senderUrl;
    const senderId = options.senderId === undefined ? EXTENSION_ID : options.senderId;
    const sender = senderUrl === null
        ? undefined
        : {
                ...(senderId === null ? {} : { id: senderId }),
                url: senderUrl,
            };
    const port = {
        name: options.name ?? SIDE_PANEL_PORT,
        ...(sender === undefined ? {} : { sender }),
        postMessage,
        disconnect: vi.fn(),
        onMessage: {
            addListener: vi.fn((listener: (message: unknown) => void) => {
                messageListeners.push(listener);
            }),
            removeListener: vi.fn(),
            hasListener: vi.fn(() => false),
            hasListeners: vi.fn(() => messageListeners.length > 0),
        },
        onDisconnect: {
            addListener: vi.fn((listener: () => void) => {
                disconnectListeners.push(listener);
            }),
            removeListener: vi.fn(),
            hasListener: vi.fn(() => false),
            hasListeners: vi.fn(() => disconnectListeners.length > 0),
        },
    } as unknown as chrome.runtime.Port;
    return {
        port,
        postMessage,
        receive(value) {
            for (const listener of messageListeners) {
                listener(value);
            }
        },
        disconnect() {
            for (const listener of disconnectListeners) {
                listener();
            }
        },
    };
}

/**
 * Builds one controller dependency harness.
 */
function dependencies(
    acquire: () => Promise<void> = async () => undefined,
): SidePanelPortControllerDependencies {
    return {
        framing: {
            acquire: vi.fn(acquire),
            release: vi.fn(async () => undefined),
        },
        sidePanelExtensionId: EXTENSION_ID,
        sidePanelDocumentUrl: SIDE_PANEL_DOCUMENT_URL,
        windows: new SidePanelWindowRegistry(),
        connectWindow: vi.fn(async () => ({ tabId: TAB_ID, projectionRevision: 4 })),
        disconnectWindow: vi.fn(async () => undefined),
        warn: vi.fn(),
    };
}

describe('SidePanelPortController', () => {
    it.each([
        {
            name: 'a different port name',
            options: { name: 'popup', senderUrl: SIDE_PANEL_DOCUMENT_URL },
        },
        {
            name: 'a missing sender',
            options: { senderUrl: null },
        },
        {
            name: 'another extension document',
            options: { senderUrl: POPUP_DOCUMENT_URL },
        },
        {
            name: 'a document attributed to another extension',
            options: { senderId: 'another-extension', senderUrl: SIDE_PANEL_DOCUMENT_URL },
        },
        {
            name: 'a document without an extension identifier',
            options: { senderId: null, senderUrl: SIDE_PANEL_DOCUMENT_URL },
        },
        {
            name: 'a side-panel URL with extra state',
            options: { senderUrl: `${SIDE_PANEL_DOCUMENT_URL}?spoofed=true` },
        },
    ])('rejects $name before framing or registration', async ({ options }) => {
        const deps = dependencies();
        const controller = new SidePanelPortController(deps);
        const client = fakePort(options);

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        client.disconnect();
        await settle();

        expect(deps.framing.acquire).not.toHaveBeenCalled();
        expect(deps.framing.release).not.toHaveBeenCalled();
        expect(deps.windows.windowIds()).toEqual([]);
        expect(deps.connectWindow).not.toHaveBeenCalled();
    });

    it('does not acquire framing until an authenticated port sends a valid context', async () => {
        const deps = dependencies();
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_KEEPALIVE });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: -1 });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: 1.5 });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: '3' });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: Number.MAX_SAFE_INTEGER + 1 });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID, unexpected: true });
        await settle();

        expect(deps.framing.acquire).not.toHaveBeenCalled();
        expect(deps.windows.windowIds()).toEqual([]);
        expect(deps.connectWindow).not.toHaveBeenCalled();

        client.disconnect();
        await settle();
        expect(deps.framing.release).not.toHaveBeenCalled();
    });

    it('does not publish READY until framing and initial active-tab sync both finish', async () => {
        const framing = deferred<void>();
        const synchronization = deferred<{ tabId: number; projectionRevision: number }>();
        const deps = dependencies(async () => framing.promise);
        vi.mocked(deps.connectWindow).mockReturnValueOnce(synchronization.promise);
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        expect(client.postMessage).toHaveBeenCalledWith({ type: SIDE_PANEL_RESET });

        framing.resolve(undefined);
        await vi.waitFor(() => {
            expect(deps.connectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        });
        expect(client.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            type: SIDE_PANEL_READY,
        }));

        synchronization.resolve({ tabId: TAB_ID, projectionRevision: 4 });
        await settle();
        expect(client.postMessage).toHaveBeenCalledWith({
            type: SIDE_PANEL_READY,
            tabId: TAB_ID,
            projectionRevision: 4,
        });
    });

    it('does not initialize after the only port disconnects before framing resolves', async () => {
        const framing = deferred<void>();
        const deps = dependencies(async () => framing.promise);
        const controller = new SidePanelPortController(deps);
        const client = fakePort();
        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });

        client.disconnect();
        framing.resolve(undefined);
        await settle();

        expect(deps.connectWindow).not.toHaveBeenCalled();
        expect(client.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            type: SIDE_PANEL_READY,
        }));
        expect(deps.disconnectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        expect(deps.framing.release).toHaveBeenCalledOnce();
    });

    it('releases the authenticated port hold after framing acquisition rejects', async () => {
        const deps = dependencies(async () => {
            throw new Error('dynamic rule unavailable');
        });
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await vi.waitFor(() => {
            expect(deps.framing.acquire).toHaveBeenCalledOnce();
            expect(deps.warn).toHaveBeenCalled();
        });

        client.disconnect();
        await settle();

        expect(deps.framing.release).toHaveBeenCalledOnce();
        expect(deps.disconnectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
    });

    it('retries initial synchronization after a superseded active tab', async () => {
        const deps = dependencies();
        vi.mocked(deps.connectWindow)
            .mockRejectedValueOnce(new DOMException('superseded', 'AbortError'))
            .mockResolvedValueOnce({ tabId: OTHER_TAB_ID, projectionRevision: 8 });
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await vi.waitFor(() => {
            expect(deps.connectWindow).toHaveBeenCalledTimes(2);
        });

        expect(client.postMessage).toHaveBeenCalledWith({
            type: SIDE_PANEL_READY,
            tabId: OTHER_TAB_ID,
            projectionRevision: 8,
        });
    });

    it('recovers one failed initial synchronization only after an authoritative event', async () => {
        const deps = dependencies();
        vi.mocked(deps.connectWindow)
            .mockRejectedValueOnce(new Error('active tab unavailable'))
            .mockResolvedValueOnce({ tabId: OTHER_TAB_ID, projectionRevision: 8 });
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await vi.waitFor(() => {
            expect(deps.warn).toHaveBeenCalledOnce();
        });

        expect(deps.connectWindow).toHaveBeenCalledOnce();
        expect(client.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            type: SIDE_PANEL_READY,
        }));

        controller.recoverWindow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(client.postMessage).toHaveBeenCalledWith({
                type: SIDE_PANEL_READY,
                tabId: OTHER_TAB_ID,
                projectionRevision: 8,
            });
        });

        expect(deps.connectWindow).toHaveBeenCalledTimes(2);
        expect(client.postMessage.mock.calls.filter((call) => {
            const message: unknown = call[0];
            return isSidePanelPortMessage(message) && message.type === SIDE_PANEL_READY;
        })).toHaveLength(1);
    });

    it('remembers recovery signaled before a delayed initial failure settles', async () => {
        const initialSynchronization = deferred<{
            tabId: number;
            projectionRevision: number;
        }>();
        const deps = dependencies();
        vi.mocked(deps.connectWindow)
            .mockReturnValueOnce(initialSynchronization.promise)
            .mockResolvedValueOnce({ tabId: OTHER_TAB_ID, projectionRevision: 8 });
        const controller = new SidePanelPortController(deps);
        const client = fakePort();

        controller.accept(client.port);
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await vi.waitFor(() => {
            expect(deps.connectWindow).toHaveBeenCalledOnce();
        });

        controller.recoverWindow(WINDOW_ID);
        await settle();
        expect(deps.connectWindow).toHaveBeenCalledOnce();

        initialSynchronization.reject(new Error('active tab unavailable'));
        await vi.waitFor(() => {
            expect(client.postMessage).toHaveBeenCalledWith({
                type: SIDE_PANEL_READY,
                tabId: OTHER_TAB_ID,
                projectionRevision: 8,
            });
        });

        expect(deps.connectWindow).toHaveBeenCalledTimes(2);
    });

    it('publishes only the newest READY when overlapping initialization resolves out of order', async () => {
        const firstSync = deferred<{ tabId: number; projectionRevision: number }>();
        const secondSync = deferred<{ tabId: number; projectionRevision: number }>();
        const deps = dependencies();
        vi.mocked(deps.connectWindow)
            .mockReturnValueOnce(firstSync.promise)
            .mockReturnValueOnce(secondSync.promise);
        const controller = new SidePanelPortController(deps);
        const first = fakePort();
        const second = fakePort();

        controller.accept(first.port);
        first.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await settle();
        controller.accept(second.port);
        second.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await settle();

        secondSync.resolve({ tabId: OTHER_TAB_ID, projectionRevision: 8 });
        await settle();
        firstSync.resolve({ tabId: TAB_ID, projectionRevision: 4 });
        await settle();

        expect(first.postMessage).toHaveBeenCalledWith({
            type: SIDE_PANEL_READY,
            tabId: OTHER_TAB_ID,
            projectionRevision: 8,
        });
        expect(second.postMessage).toHaveBeenCalledWith({
            type: SIDE_PANEL_READY,
            tabId: OTHER_TAB_ID,
            projectionRevision: 8,
        });
        expect(first.postMessage).not.toHaveBeenCalledWith({
            type: SIDE_PANEL_READY,
            tabId: TAB_ID,
            projectionRevision: 4,
        });
    });

    it('resets surviving ports and cancels work only after the last disconnect', async () => {
        const deps = dependencies();
        const controller = new SidePanelPortController(deps);
        const first = fakePort();
        const second = fakePort();
        controller.accept(first.port);
        controller.accept(second.port);
        first.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        second.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await settle();
        expect(deps.framing.acquire).toHaveBeenCalledTimes(2);
        first.postMessage.mockClear();
        second.postMessage.mockClear();
        vi.mocked(deps.connectWindow).mockClear();

        first.disconnect();
        await settle();

        expect(deps.framing.release).toHaveBeenCalledOnce();
        expect(second.postMessage).toHaveBeenCalledWith({ type: SIDE_PANEL_RESET });
        expect(second.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: SIDE_PANEL_READY,
        }));
        expect(deps.connectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        expect(deps.disconnectWindow).not.toHaveBeenCalled();

        second.disconnect();
        await settle();
        expect(deps.framing.release).toHaveBeenCalledTimes(2);
        expect(deps.disconnectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
    });

    it('keeps the real framing rule until the last authenticated overlapping port disconnects', async () => {
        const updateDynamicRules = vi.fn(async () => undefined);
        const framing = new SidePanelFraming({ updateDynamicRules });
        const deps = dependencies();
        deps.framing = framing;
        const controller = new SidePanelPortController(deps);
        const first = fakePort();
        const second = fakePort();

        controller.accept(first.port);
        first.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await vi.waitFor(() => {
            expect(updateDynamicRules).toHaveBeenCalledExactlyOnceWith({
                removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
                addRules: [framingRule()],
            });
        });

        controller.accept(second.port);
        second.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        await settle();
        expect(framing.active).toBe(true);
        expect(updateDynamicRules).toHaveBeenCalledOnce();

        first.disconnect();
        await settle();
        expect(framing.active).toBe(true);
        expect(updateDynamicRules).toHaveBeenCalledOnce();

        second.disconnect();
        await vi.waitFor(() => {
            expect(framing.active).toBe(false);
        });
        expect(updateDynamicRules).toHaveBeenCalledTimes(2);
        expect(updateDynamicRules).toHaveBeenLastCalledWith({
            removeRuleIds: [SIDE_PANEL_FRAMING_RULE_ID],
        });
    });

    it('accepts exactly one validated context and ignores keepalives', async () => {
        const deps = dependencies();
        const controller = new SidePanelPortController(deps);
        const client = fakePort();
        controller.accept(client.port);

        client.receive({ type: SIDE_PANEL_KEEPALIVE });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: OTHER_WINDOW_ID });
        client.receive({ type: SIDE_PANEL_CONTEXT, windowId: -1 });
        await settle();

        expect(deps.framing.acquire).toHaveBeenCalledOnce();
        expect(deps.windows.windowIds()).toEqual([WINDOW_ID]);
        expect(deps.connectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);

        client.disconnect();
        await settle();
        expect(deps.framing.release).toHaveBeenCalledOnce();
    });
});

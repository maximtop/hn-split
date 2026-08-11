import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };
import { HN_LOOKUP_STATUS, discussionUrl } from '../src/domain/hn';
import { SidePanelApp } from '../src/side-panel/side-panel-app';
import {
    BACKGROUND_ERROR_CODE,
    BACKGROUND_REQUEST_TYPE,
    SIDE_PANEL_CONTEXT,
    SIDE_PANEL_DISCARD_TAB,
    SIDE_PANEL_KEEPALIVE,
    SIDE_PANEL_KEEPALIVE_INTERVAL_MS,
    SIDE_PANEL_READY,
    SIDE_PANEL_RECONNECT_DELAY_MS,
    SIDE_PANEL_RESET,
    SIDE_PANEL_TARGET,
} from '../src/shared/messages';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelContent } from '../src/shared/side-panel-content';
import type { SidePanelProjection } from '../src/shared/side-panel-projection';
import { sidePanelContentKey } from '../src/shared/storage-keys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WINDOW_ID = 3;
const TAB_A = 11;
const TAB_B = 12;
const TAB_C = 13;
const TAB_D = 14;
const ITEM_A = '101';
const ITEM_B = '202';
const ITEM_C = '303';
const ITEM_D = '404';

/**
 * Resolves a promise from an explicit test boundary.
 */
interface Deferred<T> {
    /**
     * Contains the pending promise.
     */
    promise: Promise<T>;
    /**
     * Resolves the pending promise.
     */
    resolve: (value: T) => void;
}

/**
 * Exposes one connected runtime port from the Chrome double.
 */
interface FakePort {
    /**
     * Delivers one background message to the panel's port listener.
     */
    emitMessage: (message: unknown) => void;
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
 * Configures the Chrome double used by a panel test.
 */
interface FakeChromeOptions {
    /**
     * Supplies the initial stored projection.
     */
    initialProjection?: SidePanelProjection | null;
    /**
     * Delays the initial session-storage read until the test resolves it.
     */
    initialRead?: Promise<SidePanelProjection | null>;
    /**
     * Makes the initial session-storage read fail.
     */
    failInitialRead?: boolean;
    /**
     * Selects the zero-based port whose first postMessage call throws.
     */
    failInitialPostMessageForPort?: number;
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
    /**
     * Records whether the storage listener has been subscribed.
     */
    storageListenerRegistered: () => boolean;
    /**
     * Publishes one authoritative projection through the storage boundary.
     */
    publishProjection: (projection: SidePanelProjection) => void;
    /**
     * Records settings-page navigation attempts.
     */
    openOptionsPage: ReturnType<typeof vi.fn>;
}

/**
 * Exposes one rendered panel and its controllable browser boundaries.
 */
interface PanelView {
    /**
     * Contains the rendered panel DOM.
     */
    container: HTMLDivElement;
    /**
     * Contains the installed Chrome double.
     */
    fake: FakeChrome;
    /**
     * Publishes one authoritative projection.
     */
    publishProjection: (projection: SidePanelProjection) => Promise<void>;
    /**
     * Publishes one message over the newest port.
     */
    publishPortMessage: (message: unknown) => Promise<void>;
    /**
     * Disconnects the newest port.
     */
    disconnectPort: () => Promise<void>;
    /**
     * Unmounts the panel.
     */
    unmount: () => Promise<void>;
}

/**
 * Creates one manually controlled promise.
 */
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

/**
 * Builds one strict revisioned panel projection.
 * @param revision - The monotonic projection revision.
 * @param content - The authoritative panel content.
 */
function projection(revision: number, content: SidePanelContent): SidePanelProjection {
    return { revision, content };
}

/**
 * Builds one discussion content value.
 * @param tabId - The owning browser tab.
 * @param itemId - The concrete Hacker News item.
 */
function discussionContent(tabId: number, itemId: string): SidePanelContent {
    return { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId, itemId };
}

/**
 * Flushes queued React and promise work.
 */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Installs a revisioned session-storage and runtime-port Chrome double.
 * @param options - Initial storage and port-failure behavior.
 */
function installChrome(options: FakeChromeOptions = {}): FakeChrome {
    const ports: FakePort[] = [];
    const storageListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>();
    let storedProjection = options.initialProjection ?? null;
    const sendMessage = vi.fn(async () => ({
        ok: true,
        result: { content: storedProjection?.content ?? null },
    }));
    const openOptionsPage = vi.fn();
    const key = sidePanelContentKey(WINDOW_ID);
    vi.stubGlobal('chrome', {
        runtime: {
            connect: vi.fn(() => {
                const messageListeners: Array<(message: unknown) => void> = [];
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
                        addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
                    },
                    onDisconnect: {
                        addListener: (listener: () => void) => disconnectListeners.push(listener),
                    },
                    postMessage,
                    disconnect,
                };
            }),
            sendMessage,
            openOptionsPage,
        },
        storage: {
            session: {
                get: vi.fn(async () => {
                    if (options.failInitialRead === true) {
                        throw new Error('Session storage is unavailable');
                    }
                    const initial = options.initialRead === undefined
                        ? storedProjection
                        : await options.initialRead;
                    return initial === null ? {} : { [key]: initial };
                }),
                onChanged: {
                    addListener: vi.fn((listener) => storageListeners.add(listener)),
                    removeListener: vi.fn((listener) => storageListeners.delete(listener)),
                },
            },
        },
        windows: {
            getCurrent: vi.fn(async () => ({ id: WINDOW_ID })),
        },
    });
    return {
        ports,
        sendMessage,
        storageListenerRegistered: () => storageListeners.size > 0,
        publishProjection: (nextProjection) => {
            const oldValue = storedProjection;
            storedProjection = nextProjection;
            for (const listener of storageListeners) {
                listener({ [key]: { oldValue, newValue: nextProjection } });
            }
        },
        openOptionsPage,
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

/**
 * Finds one button by its visible localized name.
 * @param container - The panel DOM to search.
 * @param name - The exact localized button name.
 */
function requireButton(container: HTMLElement, name: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === name);
    if (button === undefined) {
        throw new Error(`Expected button: ${name}`);
    }
    return button;
}

/**
 * Renders one panel and waits for its initial storage reconciliation.
 * @param options - Initial storage and port-failure behavior.
 */
async function renderPanel(options: FakeChromeOptions = {}): Promise<PanelView> {
    const fake = installChrome(options);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<SidePanelApp />);
        await flush();
    });
    const newestPort = (): FakePort => requirePort(fake, fake.ports.length - 1);
    return {
        container,
        fake,
        publishProjection: async (nextProjection) => {
            await act(async () => {
                fake.publishProjection(nextProjection);
                await flush();
            });
        },
        publishPortMessage: async (message) => {
            await act(async () => {
                newestPort().emitMessage(message);
                await flush();
            });
        },
        disconnectPort: async () => {
            await act(async () => {
                newestPort().emitDisconnect();
                await flush();
            });
        },
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

/**
 * Makes one initial projection visible by publishing its exact READY stamp.
 * @param initialProjection - The projection to load and authorize.
 */
async function renderReadyPanel(initialProjection: SidePanelProjection): Promise<PanelView> {
    const view = await renderPanel({ initialProjection });
    await view.publishPortMessage({
        type: SIDE_PANEL_READY,
        tabId: initialProjection.content.tabId,
        projectionRevision: initialProjection.revision,
    });
    return view;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe('SidePanelApp', () => {
    it('subscribes before connecting and ignores a late stale initial storage read', async () => {
        const initialRead = deferred<SidePanelProjection | null>();
        const viewPromise = renderPanel({ initialRead: initialRead.promise });
        await act(flush);
        const chromeDouble = chrome as unknown as {
            runtime: { connect: ReturnType<typeof vi.fn> };
            storage: {
                session: {
                    get: ReturnType<typeof vi.fn>;
                    onChanged: { addListener: ReturnType<typeof vi.fn> };
                };
            };
        };
        expect(chromeDouble.storage.session.onChanged.addListener).toHaveBeenCalledOnce();
        expect(chromeDouble.runtime.connect).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(chromeDouble.storage.session.get).toHaveBeenCalledOnce();
        });

        const newer = projection(2, discussionContent(TAB_B, ITEM_B));
        const key = sidePanelContentKey(WINDOW_ID);
        const listener = chromeDouble.storage.session.onChanged.addListener.mock.calls[0]?.[0] as
            | ((changes: Record<string, chrome.storage.StorageChange>) => void)
            | undefined;
        if (listener === undefined) {
            throw new Error('Expected the storage listener to be registered');
        }
        await act(async () => {
            listener({ [key]: { newValue: newer } });
            initialRead.resolve(projection(1, discussionContent(TAB_A, ITEM_A)));
            await flush();
        });
        const view = await viewPromise;
        await view.publishPortMessage({
            type: SIDE_PANEL_READY,
            tabId: TAB_B,
            projectionRevision: 2,
        });

        expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_B));
        await view.unmount();
    });

    it('shows no stale outcome before the initial projection and READY stamp match', async () => {
        const initial = projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        });
        const view = await renderPanel({ initialProjection: initial });
        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_B, projectionRevision: 2 });

        expect(view.container.querySelector('button')).toBeNull();
        expect(view.container.querySelector('[role="status"]')?.textContent).not.toContain(
            enMessages.side_panel_manual_required.message,
        );
        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));
        expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_B));
        await view.unmount();
    });

    it('loads a projection stored before the panel mounted', async () => {
        const stored = projection(7, discussionContent(TAB_A, ITEM_A));
        const view = await renderPanel({ initialProjection: stored });
        expect(view.container.querySelector('iframe')).toBeNull();

        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_A, projectionRevision: 7 });

        expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_A));
        await view.unmount();
    });

    it('connects with window context even when the initial storage read fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const view = await renderPanel({ failInitialRead: true });
        const port = requirePort(view.fake, 0);

        expect(port.postMessage.mock.calls.slice(0, 2).map(([message]) => message)).toEqual([
            { type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID },
            { type: SIDE_PANEL_KEEPALIVE },
        ]);
        await view.unmount();
    });

    it('hides old content on TARGET until its reserved projection arrives', async () => {
        const view = await renderReadyPanel(projection(4, discussionContent(TAB_A, ITEM_A)));
        const frameA = view.container.querySelector('iframe');
        expect(frameA?.hidden).toBe(false);

        await view.publishPortMessage({
            type: SIDE_PANEL_TARGET,
            tabId: TAB_B,
            minimumProjectionRevision: 5,
        });

        expect(frameA?.hidden).toBe(true);
        expect(view.container.querySelector('button')).toBeNull();
        await view.publishProjection(projection(5, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_B,
        }));
        expect(requireButton(view.container, enMessages.side_panel_check_this_tab.message).hidden).toBe(false);
        await view.unmount();
    });

    it('announces manual-required and recoverable error text in one persistent live region', async () => {
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        const status = view.container.querySelector('[role="status"]');
        expect(status?.getAttribute('aria-live')).toBe('polite');
        expect(status?.getAttribute('aria-atomic')).toBe('true');
        expect(status?.textContent).toContain(enMessages.side_panel_manual_required.message);
        expect(status?.querySelector('a, button')).toBeNull();
        expect([...view.container.querySelectorAll('button')].every((button) => (
            button.getAttribute('aria-describedby') === status?.id
        ))).toBe(true);
        expect([...view.container.querySelectorAll('button, a')].map((control) => (
            control.textContent?.trim()
        ))).toEqual([
            enMessages.side_panel_check_this_tab.message,
            enMessages.side_panel_follow_tabs_automatically.message,
            enMessages.side_panel_open_on_hn.message,
        ]);

        await view.publishProjection(projection(2, {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: TAB_A,
            reason: HN_LOOKUP_STATUS.ERROR,
        }));
        expect(view.container.querySelector('[role="status"]')).toBe(status);
        expect(status?.textContent).toContain(enMessages.lookup_error.message);
        await view.unmount();
    });

    it('does nothing before a manual action and sends one trusted command per click', async () => {
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        expect(view.fake.sendMessage).not.toHaveBeenCalled();

        await act(async () => {
            requireButton(view.container, enMessages.side_panel_check_this_tab.message).click();
            await flush();
        });

        expect(view.fake.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
            windowId: WINDOW_ID,
        });
        await view.unmount();
    });

    it('uses a synchronous lock to suppress same-tick duplicate actions', async () => {
        const action = deferred<unknown>();
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        view.fake.sendMessage.mockReturnValue(action.promise);
        const button = requireButton(view.container, enMessages.side_panel_check_this_tab.message);

        await act(async () => {
            button.click();
            button.click();
            await flush();
        });

        expect(view.fake.sendMessage).toHaveBeenCalledOnce();
        action.resolve({ ok: true, result: { content: discussionContent(TAB_A, ITEM_A) } });
        await act(flush);
        await view.unmount();
    });

    it('enables following and synchronizes through one command without opening options', async () => {
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));

        await act(async () => {
            requireButton(view.container, enMessages.side_panel_follow_tabs_automatically.message).click();
            await flush();
        });

        expect(view.fake.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW,
            windowId: WINDOW_ID,
        });
        expect(view.fake.openOptionsPage).not.toHaveBeenCalled();
        await view.unmount();
    });

    it('offers retry after a recoverable lookup error', async () => {
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: TAB_A,
            reason: HN_LOOKUP_STATUS.ERROR,
        }));

        await act(async () => {
            requireButton(view.container, enMessages.side_panel_retry.message).click();
            await flush();
        });

        expect(view.fake.sendMessage).toHaveBeenCalledExactlyOnceWith({
            type: BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
            windowId: WINDOW_ID,
        });
        await view.unmount();
    });

    it('re-enables actions and shows localized feedback after transport failure', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        view.fake.sendMessage.mockResolvedValue({
            ok: false,
            error: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED,
        });
        const button = requireButton(view.container, enMessages.side_panel_check_this_tab.message);

        await act(async () => {
            button.click();
            await flush();
        });

        expect(button.disabled).toBe(false);
        expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
            enMessages.side_panel_action_failed.message,
        );
        await view.unmount();
    });

    it('treats action response content as acknowledgement-only', async () => {
        const action = deferred<unknown>();
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        view.fake.sendMessage.mockReturnValue(action.promise);
        await act(async () => {
            requireButton(view.container, enMessages.side_panel_check_this_tab.message).click();
            await flush();
        });
        await view.publishPortMessage({
            type: SIDE_PANEL_TARGET,
            tabId: TAB_B,
            minimumProjectionRevision: 2,
        });
        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));
        action.resolve({ ok: true, result: { content: discussionContent(TAB_A, ITEM_A) } });
        await act(flush);

        expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe(discussionUrl(ITEM_B));
        await view.unmount();
    });

    it('ignores a delayed action failure after TARGET switches to another tab', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const action = deferred<unknown>();
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        view.fake.sendMessage.mockReturnValue(action.promise);
        await act(async () => {
            requireButton(view.container, enMessages.side_panel_check_this_tab.message).click();
            await flush();
        });
        await view.publishPortMessage({
            type: SIDE_PANEL_TARGET,
            tabId: TAB_B,
            minimumProjectionRevision: 2,
        });
        await view.publishProjection(projection(2, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_B,
        }));
        action.resolve({ ok: false, error: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED });
        await act(flush);

        expect(view.container.querySelector('[role="alert"]')).toBeNull();
        expect(requireButton(view.container, enMessages.side_panel_check_this_tab.message).disabled).toBe(false);
        await view.unmount();
    });

    it('invalidates an action when a newer projection arrives before TARGET', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const action = deferred<unknown>();
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        await view.publishPortMessage({
            type: SIDE_PANEL_TARGET,
            tabId: TAB_A,
            minimumProjectionRevision: 1,
        });
        view.fake.sendMessage.mockReturnValue(action.promise);
        await act(async () => {
            requireButton(view.container, enMessages.side_panel_check_this_tab.message).click();
            await flush();
        });

        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));
        expect(view.container.querySelector('iframe')).toBeNull();
        action.resolve({ ok: false, error: BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED });
        await act(flush);

        expect(view.container.querySelector('[role="alert"]')).toBeNull();
        await view.publishPortMessage({
            type: SIDE_PANEL_TARGET,
            tabId: TAB_B,
            minimumProjectionRevision: 2,
        });
        expect(view.container.querySelector('iframe')?.src).toBe(discussionUrl(ITEM_B));
        await view.unmount();
    });

    it('retains exact iframe nodes across A to B to A and hides inactive frames', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const frameA = view.container.querySelector('iframe');
        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));
        const framesAfterB = [...view.container.querySelectorAll('iframe')];
        const frameB = framesAfterB.find((frame) => frame.src === discussionUrl(ITEM_B));
        await view.publishProjection(projection(3, discussionContent(TAB_A, ITEM_A)));

        expect([...view.container.querySelectorAll('iframe')]).toEqual([frameA, frameB]);
        expect(frameA?.hidden).toBe(false);
        expect(frameB?.hidden).toBe(true);
        expect(frameB?.getAttribute('aria-hidden')).toBe('true');
        expect(frameB?.getAttribute('tabindex')).toBe('-1');
        expect(frameB?.hasAttribute('inert')).toBe(true);
        await view.unmount();
    });

    it('evicts the least-recently-used inactive iframe without reordering survivors', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const frameA = view.container.querySelector('iframe');
        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));
        const frameB = [...view.container.querySelectorAll('iframe')]
            .find((frame) => frame.src === discussionUrl(ITEM_B));
        await view.publishProjection(projection(3, discussionContent(TAB_C, ITEM_C)));
        await view.publishProjection(projection(4, discussionContent(TAB_A, ITEM_A)));
        await view.publishProjection(projection(5, discussionContent(TAB_D, ITEM_D)));

        const frames = [...view.container.querySelectorAll('iframe')];
        expect(frames).toHaveLength(3);
        expect(frames).toContain(frameA);
        expect(frames).not.toContain(frameB);
        expect(frames.map((frame) => frame.src)).toEqual([
            discussionUrl(ITEM_A),
            discussionUrl(ITEM_C),
            discussionUrl(ITEM_D),
        ]);
        await view.unmount();
    });

    it('discards only retained frames for the requested tab', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));

        await view.publishPortMessage({ type: SIDE_PANEL_DISCARD_TAB, tabId: TAB_A });

        const frames = [...view.container.querySelectorAll('iframe')];
        expect(frames).toHaveLength(1);
        expect(frames[0]?.src).toBe(discussionUrl(ITEM_B));
        await view.unmount();
    });

    it('blurs an active frame before DISCARD_TAB removes it', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const frame = view.container.querySelector('iframe');
        frame?.focus();
        expect(document.activeElement).toBe(frame);

        await view.publishPortMessage({ type: SIDE_PANEL_DISCARD_TAB, tabId: TAB_A });

        expect(document.activeElement).not.toBe(frame);
        expect(view.container.querySelector('iframe')).toBeNull();
        await view.unmount();
    });

    it('retains projection but destroys every frame and action on RESET', async () => {
        const stored = projection(41, discussionContent(TAB_A, ITEM_A));
        const view = await renderReadyPanel(stored);
        const oldFrame = view.container.querySelector('iframe');
        const next = projection(42, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_B,
        });
        await view.publishProjection(next);

        await view.publishPortMessage({ type: SIDE_PANEL_RESET });
        expect(view.container.querySelector('button')).toBeNull();
        expect(view.container.querySelector('iframe')).toBeNull();
        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_B, projectionRevision: 42 });
        expect(requireButton(view.container, enMessages.side_panel_check_this_tab.message)).not.toBeNull();
        expect(view.container.querySelector('iframe')).not.toBe(oldFrame);
        await view.unmount();
    });

    it('restores a pending projection stored before RESET after exact READY', async () => {
        const pending = projection(9, {
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: TAB_A,
        });
        const view = await renderPanel({ initialProjection: pending });
        await view.publishPortMessage({ type: SIDE_PANEL_RESET });
        expect(view.container.querySelector('[role="status"]')?.textContent).not.toContain(
            enMessages.side_panel_pending.message,
        );

        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_A, projectionRevision: 9 });
        expect(view.container.querySelector('[role="status"]')?.textContent).toContain(
            enMessages.side_panel_pending.message,
        );
        await view.unmount();
    });

    it('blurs the outgoing frame before hiding it', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const oldFrame = view.container.querySelector('iframe');
        oldFrame?.focus();
        expect(document.activeElement).toBe(oldFrame);

        await view.publishProjection(projection(2, discussionContent(TAB_B, ITEM_B)));

        expect(document.activeElement).not.toBe(oldFrame);
        expect(oldFrame?.hidden).toBe(true);
        await view.unmount();
    });

    it('does not blur or replace a frame for a newer projection of the same tuple', async () => {
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const frame = view.container.querySelector('iframe');
        frame?.focus();

        await view.publishProjection(projection(2, discussionContent(TAB_A, ITEM_A)));

        expect(document.activeElement).toBe(frame);
        expect(view.container.querySelector('iframe')).toBe(frame);
        await view.unmount();
    });

    it('destroys retained nodes on disconnect before reconnect readiness', async () => {
        vi.useFakeTimers();
        const view = await renderReadyPanel(projection(1, discussionContent(TAB_A, ITEM_A)));
        const oldFrame = view.container.querySelector('iframe');

        await view.disconnectPort();
        expect(view.container.querySelector('iframe')).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(SIDE_PANEL_RECONNECT_DELAY_MS);
            await flush();
        });
        expect(view.fake.ports).toHaveLength(2);
        expect(view.container.querySelector('iframe')).toBeNull();
        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_A, projectionRevision: 1 });
        expect(view.container.querySelector('iframe')).not.toBe(oldFrame);
        await view.unmount();
    });

    it('posts window context before keepalive and stops heartbeats after unmount', async () => {
        vi.useFakeTimers();
        const view = await renderReadyPanel(projection(1, {
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_A,
        }));
        const port = requirePort(view.fake, 0);
        expect(port.postMessage.mock.calls.slice(0, 2).map(([message]) => message)).toEqual([
            { type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID },
            { type: SIDE_PANEL_KEEPALIVE },
        ]);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        });
        expect(port.postMessage).toHaveBeenCalledTimes(4);

        await view.unmount();
        await vi.advanceTimersByTimeAsync(SIDE_PANEL_KEEPALIVE_INTERVAL_MS * 2);
        expect(port.postMessage).toHaveBeenCalledTimes(4);
        expect(port.disconnect).toHaveBeenCalledOnce();
    });

    it('does not orphan a heartbeat when posting initial context fails', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const view = await renderPanel({ failInitialPostMessageForPort: 0 });
        const failedPort = requirePort(view.fake, 0);
        expect(failedPort.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: SIDE_PANEL_CONTEXT,
            windowId: WINDOW_ID,
        });
        expect(failedPort.disconnect).toHaveBeenCalledOnce();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(SIDE_PANEL_RECONNECT_DELAY_MS);
            await flush();
        });

        const replacement = requirePort(view.fake, 1);
        expect(replacement.postMessage.mock.calls.slice(0, 2).map(([message]) => message)).toEqual([
            { type: SIDE_PANEL_CONTEXT, windowId: WINDOW_ID },
            { type: SIDE_PANEL_KEEPALIVE },
        ]);
        await view.unmount();
    });

    it('ignores malformed port messages', async () => {
        const view = await renderPanel({
            initialProjection: projection(1, discussionContent(TAB_A, ITEM_A)),
        });

        await view.publishPortMessage({ type: SIDE_PANEL_READY, tabId: TAB_A });
        await view.publishPortMessage({
            type: SIDE_PANEL_READY,
            tabId: TAB_A,
            projectionRevision: 1,
            pageUrl: 'https://private.example/path',
        });

        expect(view.container.querySelector('iframe')).toBeNull();
        await view.unmount();
    });
});

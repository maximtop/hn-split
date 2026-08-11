import { describe, expect, it, vi } from 'vitest';

import {
    SidePanelLifecycleController,
} from '../src/background/side-panel-content-controller';
import type {
    SidePanelLifecycleControllerDependencies,
} from '../src/background/side-panel-content-controller';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelProjection } from '../src/shared/side-panel-projection';

const WINDOW_ID = 3;
const OTHER_WINDOW_ID = 4;
const TAB_ID = 7;
const OTHER_TAB_ID = 8;
const LINK_URL = 'https://example.com/story';

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve(value: Value): void;
}

/**
 * Creates a manually settled promise for lifecycle ordering tests.
 */
function deferred<Value>(): Deferred<Value> {
    let resolve: (value: Value) => void = () => undefined;
    const promise = new Promise<Value>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

/**
 * Builds one strict terminal projection.
 */
function projection(tabId = TAB_ID, revision = 2): SidePanelProjection {
    return {
        revision,
        content: {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId,
            reason: 'not_found',
        },
    };
}

/**
 * Builds an observable lifecycle dependency harness.
 */
function dependencies(live = true): SidePanelLifecycleControllerDependencies {
    return {
        windows: { has: vi.fn(() => live) },
        content: {
            connect: vi.fn(async () => projection()),
            activate: vi.fn(async (_windowId, tabId) => projection(tabId)),
            recover: vi.fn(async (_reservation, tabId) => projection(tabId)),
            navigation: vi.fn(async () => null),
            resumePendingUrl: vi.fn(async () => null),
            forgetTab: vi.fn(async () => undefined),
            disconnectWindow: vi.fn(async () => undefined),
            forgetWindow: vi.fn(async () => undefined),
        },
        getActiveTab: vi.fn(async (windowId: number) => ({
            id: TAB_ID,
            windowId,
            active: true,
            index: 0,
            url: LINK_URL,
        }) as chrome.tabs.Tab),
        getTab: vi.fn(async (tabId: number) => ({
            id: tabId,
            windowId: WINDOW_ID,
            active: true,
            index: 0,
            url: LINK_URL,
        }) as chrome.tabs.Tab),
    };
}

describe('SidePanelLifecycleController', () => {
    it('does no activation work for a window without a live panel', async () => {
        const deps = dependencies(false);
        const controller = new SidePanelLifecycleController(deps);

        await controller.activateTab(TAB_ID, WINDOW_ID);

        expect(deps.getActiveTab).not.toHaveBeenCalled();
        expect(deps.getTab).not.toHaveBeenCalled();
        expect(deps.content.activate).not.toHaveBeenCalled();
    });

    it('connects the active tab without reading its URL before the owner asks', async () => {
        const deps = dependencies();
        const controller = new SidePanelLifecycleController(deps);

        const stamp = await controller.connectWindow(WINDOW_ID);

        expect(stamp).toEqual({ tabId: TAB_ID, projectionRevision: 2 });
        expect(deps.content.connect).toHaveBeenCalledWith(
            WINDOW_ID,
            TAB_ID,
            expect.any(Function),
        );
        expect(deps.getTab).not.toHaveBeenCalled();
    });

    it('routes closed-panel URL updates only to association invalidation', async () => {
        const deps = dependencies(false);
        const controller = new SidePanelLifecycleController(deps);

        const authoritative = await controller.updateTab(TAB_ID, WINDOW_ID, true, {
            status: 'complete',
            url: LINK_URL,
        });

        expect(deps.content.navigation).toHaveBeenCalledExactlyOnceWith(
            WINDOW_ID,
            TAB_ID,
            LINK_URL,
            true,
            false,
        );
        expect(deps.content.resumePendingUrl).not.toHaveBeenCalled();
        expect(deps.getTab).not.toHaveBeenCalled();
        expect(authoritative).toBe(false);
    });

    it('lazily reads the still-owned tab URL for a live pending completion', async () => {
        const deps = dependencies();
        vi.mocked(deps.content.resumePendingUrl).mockImplementationOnce(
            async (_windowId, _tabId, readUrl) => {
                await expect(readUrl()).resolves.toBe(LINK_URL);
                return projection();
            },
        );
        const controller = new SidePanelLifecycleController(deps);

        const authoritative = await controller.updateTab(
            TAB_ID,
            WINDOW_ID,
            true,
            { status: 'complete' },
        );

        expect(deps.content.resumePendingUrl).toHaveBeenCalledOnce();
        expect(deps.getTab).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        expect(authoritative).toBe(true);
    });

    it('does not mark an inactive update as authoritative for panel recovery', async () => {
        const deps = dependencies();
        const controller = new SidePanelLifecycleController(deps);

        const authoritative = await controller.updateTab(
            TAB_ID,
            WINDOW_ID,
            false,
            { status: 'complete' },
        );

        expect(authoritative).toBe(false);
        expect(deps.content.resumePendingUrl).not.toHaveBeenCalled();
    });

    it('finishes replacement cleanup before synchronizing the added active tab', async () => {
        const cleanup = deferred<void>();
        const deps = dependencies();
        vi.mocked(deps.content.forgetTab).mockReturnValueOnce(cleanup.promise);
        vi.mocked(deps.getTab).mockResolvedValueOnce({
            id: TAB_ID,
            windowId: WINDOW_ID,
            active: true,
            index: 0,
        } as chrome.tabs.Tab);
        const controller = new SidePanelLifecycleController(deps);

        const replacing = controller.replaceTab(TAB_ID, OTHER_TAB_ID);
        await Promise.resolve();
        expect(deps.getTab).not.toHaveBeenCalled();
        cleanup.resolve(undefined);
        await replacing;

        expect(deps.content.forgetTab).toHaveBeenCalledExactlyOnceWith(OTHER_TAB_ID);
        expect(deps.content.activate).toHaveBeenCalledWith(
            WINDOW_ID,
            TAB_ID,
            expect.any(Function),
        );
    });

    it('validates attachment ownership before synchronizing an active destination tab', async () => {
        const deps = dependencies();
        vi.mocked(deps.getTab)
            .mockResolvedValueOnce({
                id: TAB_ID,
                windowId: OTHER_WINDOW_ID,
                active: true,
                index: 0,
            } as chrome.tabs.Tab)
            .mockResolvedValueOnce({
                id: TAB_ID,
                windowId: WINDOW_ID,
                active: true,
                index: 0,
            } as chrome.tabs.Tab);
        const controller = new SidePanelLifecycleController(deps);

        await controller.attachTab(TAB_ID, WINDOW_ID);
        expect(deps.content.activate).not.toHaveBeenCalled();

        await controller.attachTab(TAB_ID, WINDOW_ID);
        expect(deps.content.activate).toHaveBeenCalledExactlyOnceWith(
            WINDOW_ID,
            TAB_ID,
            expect.any(Function),
        );
    });

    it('resynchronizes the tab active at recovery time and routes cleanup', async () => {
        const deps = dependencies();
        vi.mocked(deps.getActiveTab).mockResolvedValueOnce({
            id: OTHER_TAB_ID,
            windowId: WINDOW_ID,
            active: true,
            index: 0,
        } as chrome.tabs.Tab);
        const controller = new SidePanelLifecycleController(deps);
        const recovery = {
            windowId: WINDOW_ID,
            token: 1,
            signal: new AbortController().signal,
        };

        await controller.resynchronizeWindow(recovery);
        await controller.forgetTab(TAB_ID, WINDOW_ID);
        await controller.disconnectWindow(WINDOW_ID);
        await controller.removeWindow(WINDOW_ID);

        expect(deps.content.recover).toHaveBeenCalledWith(
            recovery,
            OTHER_TAB_ID,
            expect.any(Function),
        );
        expect(deps.content.forgetTab).toHaveBeenCalledWith(TAB_ID, WINDOW_ID);
        expect(deps.content.disconnectWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        expect(deps.content.forgetWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
    });
});

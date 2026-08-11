import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelProjection } from '../src/shared/side-panel-projection';
import type {
    SidePanelFollowActivationReservation,
    SidePanelFollowAuthorityReservation,
} from '../src/browser/side-panel-content-router';

const mocks = vi.hoisted(() => ({
    getActiveTab: vi.fn(),
    getTab: vi.fn(),
    getFollow: vi.fn(),
    setFollow: vi.fn(),
    windowsHas: vi.fn(),
    windowIds: vi.fn(),
    captureAuthority: vi.fn(),
    reserveFollow: vi.fn(),
    cancelFollow: vi.fn(),
    continueFollow: vi.fn(),
    activate: vi.fn(),
    restoreOrCheck: vi.fn(),
    disableAutomatic: vi.fn(),
}));

vi.mock('../src/background/chrome-adapters', () => ({
    getActiveTab: mocks.getActiveTab,
    getBrowserTab: mocks.getTab,
    getSidePanelFollowEnabled: mocks.getFollow,
    setSidePanelFollowEnabled: mocks.setFollow,
}));

vi.mock('../src/background/side-panel-content-controller', () => ({
    sidePanelWindows: {
        has: mocks.windowsHas,
        windowIds: mocks.windowIds,
    },
    captureSidePanelFollowAuthority: mocks.captureAuthority,
    reserveSidePanelFollowActivationIfCurrent: mocks.reserveFollow,
    cancelSidePanelFollowActivation: mocks.cancelFollow,
    continueSidePanelFollowActivation: mocks.continueFollow,
    restoreOrCheckSidePanelTab: mocks.restoreOrCheck,
    synchronizeSidePanelFollowSettingWithStatus: mocks.activate,
    disableAutomaticSidePanelFollow: mocks.disableAutomatic,
}));

import {
    checkActiveSidePanelTab,
    enableSidePanelFollow,
    setSidePanelFollowSetting,
} from '../src/background/side-panel-follow-controller';

const WINDOW_ID = 3;
const OTHER_WINDOW_ID = 4;
const TAB_ID = 7;
const OTHER_TAB_ID = 8;
const ITEM_ID = '424242';
const LINK_URL = 'https://example.com/story';

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve(value: Value): void;
}

interface TabFixture {
    id: number;
    windowId: number;
    index: number;
    active?: boolean;
    url?: string;
}

/**
 * Creates one manually settled promise for queue assertions.
 */
function deferred<Value>(): Deferred<Value> {
    let resolve: (value: Value) => void = () => undefined;
    const promise = new Promise<Value>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

/**
 * Builds one strict discussion projection.
 * @param tabId - The tab displayed by the projection.
 */
function discussionProjection(tabId: number): SidePanelProjection {
    return {
        revision: 1,
        content: {
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            tabId,
            itemId: ITEM_ID,
        },
    };
}

describe('side panel follow controller', () => {
    let storedEnabled = false;

    beforeEach(() => {
        vi.clearAllMocks();
        storedEnabled = false;
        mocks.getFollow.mockImplementation(async () => storedEnabled);
        mocks.setFollow.mockImplementation(async (enabled: boolean) => {
            storedEnabled = enabled;
        });
        mocks.windowsHas.mockReturnValue(true);
        mocks.windowIds.mockReturnValue([WINDOW_ID]);
        mocks.captureAuthority.mockImplementation((windowId: number) => ({
            windowId,
            token: 0,
        }));
        mocks.getActiveTab.mockImplementation(async (windowId: number) => ({
            id: windowId === OTHER_WINDOW_ID ? OTHER_TAB_ID : TAB_ID,
            windowId,
            index: 0,
        }));
        mocks.getTab.mockImplementation(async (tabId: number) => ({
            id: tabId,
            windowId: tabId === OTHER_TAB_ID ? OTHER_WINDOW_ID : WINDOW_ID,
            index: 0,
            active: true,
            url: LINK_URL,
        }));
        mocks.reserveFollow.mockImplementation((
            authority: SidePanelFollowAuthorityReservation,
            tabId: number,
        ) => ({
            windowId: authority.windowId,
            tabId,
            token: 1,
        }));
        mocks.continueFollow.mockImplementation(async (
            reservation: SidePanelFollowActivationReservation,
        ) => ({
            kind: 'continued',
            projection: discussionProjection(reservation.tabId),
        }));
        mocks.activate.mockImplementation(async (
            _authority: unknown,
            tabId: number,
        ) => ({
            kind: 'continued',
            projection: discussionProjection(tabId),
        }));
        mocks.restoreOrCheck.mockImplementation(async (
            _windowId: number,
            tabId: number,
        ) => discussionProjection(tabId));
        mocks.disableAutomatic.mockResolvedValue(undefined);
    });

    it('checks the tab active at handling time without changing any setting', async () => {
        const content = await checkActiveSidePanelTab(WINDOW_ID);

        expect(content).toEqual(discussionProjection(TAB_ID).content);
        expect(mocks.restoreOrCheck).toHaveBeenCalledExactlyOnceWith(
            WINDOW_ID,
            TAB_ID,
            expect.any(Function),
        );
        expect(mocks.getFollow).not.toHaveBeenCalled();
        expect(mocks.setFollow).not.toHaveBeenCalled();
    });

    it('restores the captured association without acquiring its URL', async () => {
        mocks.restoreOrCheck.mockResolvedValueOnce(discussionProjection(TAB_ID));

        await checkActiveSidePanelTab(WINDOW_ID);

        expect(mocks.getTab).not.toHaveBeenCalled();
    });

    it('enables follow and synchronizes the action-time tab in one command', async () => {
        const content = await enableSidePanelFollow(WINDOW_ID);

        expect(content).toEqual(discussionProjection(TAB_ID).content);
        expect(mocks.setFollow).toHaveBeenCalledExactlyOnceWith(true);
        expect(mocks.reserveFollow).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ windowId: WINDOW_ID }),
            TAB_ID,
        );
        expect(mocks.continueFollow).toHaveBeenCalledWith(
            expect.objectContaining({ windowId: WINDOW_ID, tabId: TAB_ID }),
            expect.any(Function),
        );
        expect(mocks.activate).not.toHaveBeenCalled();
        expect(mocks.disableAutomatic).not.toHaveBeenCalled();
    });

    it('captures the trusted tab before an earlier follow transaction leaves the queue', async () => {
        const blocked = deferred<void>();
        mocks.setFollow.mockImplementationOnce(async (enabled: boolean) => {
            await blocked.promise;
            storedEnabled = enabled;
        }).mockImplementation(async (enabled: boolean) => {
            storedEnabled = enabled;
        });
        const earlier = setSidePanelFollowSetting(false);
        await vi.waitFor(() => {
            expect(mocks.setFollow).toHaveBeenCalledOnce();
        });

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.reserveFollow).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ windowId: WINDOW_ID }),
                TAB_ID,
            );
        });
        mocks.getActiveTab.mockResolvedValue({
            id: OTHER_TAB_ID,
            windowId: WINDOW_ID,
            index: 0,
        });
        blocked.resolve();
        await Promise.all([earlier, enabling]);

        expect(mocks.continueFollow).toHaveBeenCalledWith(
            expect.objectContaining({ tabId: TAB_ID }),
            expect.any(Function),
        );
    });

    it('does not acquire the captured URL until the enable transaction persists consent', async () => {
        const persisted = deferred<void>();
        mocks.setFollow.mockImplementationOnce(async (enabled: boolean) => {
            await persisted.promise;
            storedEnabled = enabled;
        });
        mocks.continueFollow.mockImplementationOnce(async (
            _reservation: unknown,
            readUrl: () => Promise<string | undefined>,
        ) => {
            await readUrl();
            return {
                kind: 'continued',
                projection: discussionProjection(TAB_ID),
            };
        });

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.setFollow).toHaveBeenCalledExactlyOnceWith(true);
        });

        expect(mocks.getTab).not.toHaveBeenCalled();
        expect(mocks.continueFollow).not.toHaveBeenCalled();
        persisted.resolve();
        await enabling;
        expect(mocks.getTab).toHaveBeenCalled();
    });

    it('synchronizes every live window for an ordinary setting enable', async () => {
        mocks.windowIds.mockReturnValue([WINDOW_ID, OTHER_WINDOW_ID]);

        await expect(setSidePanelFollowSetting(true)).resolves.toBe(true);

        expect(mocks.activate).toHaveBeenCalledTimes(2);
        expect(mocks.activate).toHaveBeenCalledWith(
            expect.objectContaining({ windowId: WINDOW_ID }),
            TAB_ID,
            expect.any(Function),
        );
        expect(mocks.activate).toHaveBeenCalledWith(
            expect.objectContaining({ windowId: OTHER_WINDOW_ID }),
            OTHER_TAB_ID,
            expect.any(Function),
        );
        expect(mocks.reserveFollow).not.toHaveBeenCalled();
    });

    it('keeps follow enabled when a real later activation supersedes continuation', async () => {
        mocks.continueFollow.mockResolvedValueOnce({ kind: 'active_tab_changed' });
        mocks.getActiveTab
            .mockResolvedValueOnce({ id: TAB_ID, windowId: WINDOW_ID, index: 0 })
            .mockResolvedValueOnce({ id: OTHER_TAB_ID, windowId: WINDOW_ID, index: 0 });

        const content = await enableSidePanelFollow(WINDOW_ID);

        expect(content.tabId).toBe(OTHER_TAB_ID);
        expect(storedEnabled).toBe(true);
        expect(mocks.setFollow).toHaveBeenCalledExactlyOnceWith(true);
        expect(mocks.disableAutomatic).not.toHaveBeenCalled();
    });

    it('keeps follow enabled when a newer manual Check supersedes its capture', async () => {
        const checked = discussionProjection(TAB_ID);
        mocks.continueFollow.mockResolvedValueOnce({
            kind: 'superseded',
            projection: checked,
        });

        const content = await enableSidePanelFollow(WINDOW_ID);

        expect(content).toEqual(checked.content);
        expect(storedEnabled).toBe(true);
        expect(mocks.disableAutomatic).not.toHaveBeenCalled();
        expect(mocks.activate).not.toHaveBeenCalled();
    });

    it('falls forward only when the crossed authority came from a real activation', async () => {
        const staleTab = deferred<TabFixture | null>();
        let authorityToken = 0;
        mocks.captureAuthority.mockImplementation((windowId: number) => ({
            windowId,
            token: authorityToken,
        }));
        mocks.getActiveTab
            .mockReturnValueOnce(staleTab.promise)
            .mockResolvedValueOnce({ id: OTHER_TAB_ID, windowId: WINDOW_ID, index: 0 });
        mocks.reserveFollow.mockImplementation((
            authority: SidePanelFollowAuthorityReservation,
            tabId: number,
        ) => (
            authority.token === authorityToken
                ? { windowId: authority.windowId, tabId, token: 1 }
                : null
        ));
        mocks.activate.mockImplementation(async (
            authority: SidePanelFollowAuthorityReservation,
            tabId: number,
        ) => authority.token === 0
            ? { kind: 'active_tab_changed' }
            : {
                    kind: 'continued',
                    projection: discussionProjection(tabId),
                });

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        authorityToken = 1;
        staleTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(enabling).resolves.toMatchObject({ tabId: OTHER_TAB_ID });
        expect(mocks.reserveFollow).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ token: 0 }),
            TAB_ID,
        );
        expect(mocks.activate).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ token: 0 }),
            TAB_ID,
            expect.any(Function),
        );
        expect(mocks.activate).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ token: 1 }),
            OTHER_TAB_ID,
            expect.any(Function),
        );
        expect(mocks.continueFollow).not.toHaveBeenCalled();
    });

    it('enables follow without replacing a newer explicit operation crossed by the tab read', async () => {
        const activeTab = deferred<TabFixture | null>();
        const explicit = discussionProjection(OTHER_TAB_ID);
        let authorityToken = 0;
        mocks.captureAuthority.mockImplementation((windowId: number) => ({
            windowId,
            token: authorityToken,
        }));
        mocks.getActiveTab.mockReturnValueOnce(activeTab.promise);
        mocks.reserveFollow.mockImplementation((
            authority: SidePanelFollowAuthorityReservation,
            tabId: number,
        ) => (
            authority.token === authorityToken
                ? { windowId: authority.windowId, tabId, token: 1 }
                : null
        ));
        mocks.activate.mockResolvedValue({
            kind: 'superseded',
            projection: explicit,
        });

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        authorityToken = 1;
        activeTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(enabling).resolves.toEqual(explicit.content);
        expect(storedEnabled).toBe(true);
        expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        expect(mocks.reserveFollow).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ token: 0 }),
            TAB_ID,
        );
        expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ token: 0 }),
            TAB_ID,
            expect.any(Function),
        );
        expect(mocks.continueFollow).not.toHaveBeenCalled();
        expect(mocks.getTab).not.toHaveBeenCalled();
    });

    it('returns a newer manual result crossed by Check active-tab acquisition', async () => {
        const activeTab = deferred<TabFixture | null>();
        const manual = discussionProjection(OTHER_TAB_ID);
        let authorityToken = 0;
        mocks.captureAuthority.mockImplementation((windowId: number) => ({
            windowId,
            token: authorityToken,
        }));
        mocks.getActiveTab.mockReturnValueOnce(activeTab.promise);
        mocks.activate.mockResolvedValue({
            kind: 'superseded',
            projection: manual,
        });

        const checking = checkActiveSidePanelTab(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        authorityToken = 1;
        activeTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(checking).resolves.toEqual(manual.content);
        expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ token: 0 }),
            TAB_ID,
            expect.any(Function),
        );
        expect(mocks.restoreOrCheck).not.toHaveBeenCalled();
        expect(mocks.getTab).not.toHaveBeenCalled();
        expect(mocks.getFollow).not.toHaveBeenCalled();
        expect(mocks.setFollow).not.toHaveBeenCalled();
    });

    it('falls forward to the current tab when the captured tab is already inactive', async () => {
        mocks.getActiveTab
            .mockResolvedValueOnce({ id: TAB_ID, windowId: WINDOW_ID, index: 0 })
            .mockResolvedValueOnce({ id: OTHER_TAB_ID, windowId: WINDOW_ID, index: 0 });
        mocks.getTab.mockResolvedValueOnce({
            id: TAB_ID,
            windowId: WINDOW_ID,
            index: 0,
            active: false,
            url: LINK_URL,
        });

        const content = await enableSidePanelFollow(WINDOW_ID);

        expect(content.tabId).toBe(OTHER_TAB_ID);
        expect(mocks.cancelFollow).toHaveBeenCalledOnce();
        expect(mocks.continueFollow).not.toHaveBeenCalled();
        expect(mocks.activate).toHaveBeenCalledWith(
            expect.any(Object),
            OTHER_TAB_ID,
            expect.any(Function),
        );
    });

    it('does not start ordinary synchronization after the panel disconnects during tab read', async () => {
        const activeTab = deferred<TabFixture | null>();
        let live = true;
        mocks.windowsHas.mockImplementation(() => live);
        mocks.getActiveTab.mockReturnValueOnce(activeTab.promise);

        const enabling = setSidePanelFollowSetting(true);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        live = false;
        activeTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(enabling).resolves.toBe(true);
        expect(mocks.activate).not.toHaveBeenCalled();
        expect(mocks.getTab).not.toHaveBeenCalled();
    });

    it('cancels one-click continuation after disconnect during ownership read', async () => {
        const capturedTab = deferred<TabFixture | null>();
        let live = true;
        mocks.windowsHas.mockImplementation(() => live);
        mocks.getTab.mockReturnValueOnce(capturedTab.promise);

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getTab).toHaveBeenCalledOnce();
        });
        live = false;
        capturedTab.resolve({
            id: TAB_ID,
            windowId: WINDOW_ID,
            index: 0,
            active: true,
            url: LINK_URL,
        });

        await expect(enabling).rejects.toBeInstanceOf(Error);
        expect(mocks.continueFollow).not.toHaveBeenCalled();
        expect(mocks.cancelFollow).toHaveBeenCalled();
        expect(storedEnabled).toBe(false);
    });

    it('does not reserve or mutate after disconnect during the initial active-tab read', async () => {
        const activeTab = deferred<TabFixture | null>();
        let live = true;
        mocks.windowsHas.mockImplementation(() => live);
        mocks.getActiveTab.mockReturnValueOnce(activeTab.promise);

        const enabling = enableSidePanelFollow(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        live = false;
        activeTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(enabling).rejects.toThrow('Side panel window is not connected');
        expect(mocks.reserveFollow).not.toHaveBeenCalled();
        expect(mocks.setFollow).not.toHaveBeenCalled();
    });

    it('does not start Check after disconnect during the active-tab read', async () => {
        const activeTab = deferred<TabFixture | null>();
        let live = true;
        mocks.windowsHas.mockImplementation(() => live);
        mocks.getActiveTab.mockReturnValueOnce(activeTab.promise);

        const checking = checkActiveSidePanelTab(WINDOW_ID);
        await vi.waitFor(() => {
            expect(mocks.getActiveTab).toHaveBeenCalledOnce();
        });
        live = false;
        activeTab.resolve({ id: TAB_ID, windowId: WINDOW_ID, index: 0 });

        await expect(checking).rejects.toThrow('Side panel window is not connected');
        expect(mocks.restoreOrCheck).not.toHaveBeenCalled();
    });

    it('disabling follow cancels only unfinished automatic panel work', async () => {
        storedEnabled = true;

        await expect(setSidePanelFollowSetting(false)).resolves.toBe(false);

        expect(mocks.setFollow).toHaveBeenCalledExactlyOnceWith(false);
        expect(mocks.disableAutomatic).toHaveBeenCalledOnce();
        expect(mocks.activate).not.toHaveBeenCalled();
        expect(mocks.restoreOrCheck).not.toHaveBeenCalled();
    });

    it('rolls storage and automatic effects back when live-window enable fails', async () => {
        mocks.activate.mockRejectedValueOnce(new Error('tab disappeared'));

        await expect(setSidePanelFollowSetting(true)).rejects.toBeInstanceOf(AggregateError);

        expect(mocks.setFollow.mock.calls).toEqual([[true], [false]]);
        expect(mocks.disableAutomatic).toHaveBeenCalledOnce();
        expect(storedEnabled).toBe(false);
    });

    it('fails closed when a one-click action names a window without a live panel', async () => {
        mocks.windowsHas.mockReturnValue(false);

        await expect(checkActiveSidePanelTab(WINDOW_ID)).rejects.toThrow(
            'Side panel window is not connected',
        );
        await expect(enableSidePanelFollow(WINDOW_ID)).rejects.toThrow(
            'Side panel window is not connected',
        );
        expect(mocks.getActiveTab).not.toHaveBeenCalled();
        expect(mocks.setFollow).not.toHaveBeenCalled();
    });
});

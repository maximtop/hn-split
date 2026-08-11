import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    /**
     * Creates an observable Chrome event boundary.
     */
    function event() {
        const listeners: Array<(...arguments_: never[]) => unknown> = [];
        return {
            addListener: vi.fn((listener: (...arguments_: never[]) => unknown) => {
                listeners.push(listener);
            }),
            emit: (...arguments_: never[]) => {
                for (const listener of listeners) {
                    listener(...arguments_);
                }
            },
        };
    }

    return {
        acceptPort: vi.fn(),
        recoverWindow: vi.fn(),
        handleActivated: vi.fn(),
        handleUpdated: vi.fn(),
        logFollowWarning: vi.fn(),
        events: {
            contextMenuClicked: event(),
            runtimeConnect: event(),
            runtimeMessage: event(),
            tabActivated: event(),
            tabAttached: event(),
            tabDetached: event(),
            tabRemoved: event(),
            tabReplaced: event(),
            tabUpdated: event(),
            windowRemoved: event(),
        },
    };
});

vi.mock('../src/background/article-click-controller', () => ({
    handleArticleClickMessage: vi.fn(),
    reconcileArticleClickRegistration: vi.fn(async () => undefined),
}));

vi.mock('../src/background/automatic-availability-controller', () => ({
    forgetAutomaticAvailabilityTab: vi.fn(),
    reportsAutomaticAvailabilityNavigation: vi.fn(() => false),
    updateAutomaticAvailability: vi.fn(async () => undefined),
}));

vi.mock('../src/background/chrome-adapters', () => ({
    sessionStore: { remove: vi.fn(async () => undefined) },
}));

vi.mock('../src/background/request-handler', () => ({
    handleRequest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/background/side-panel-content-controller', () => ({
    connectSidePanelWindow: vi.fn(),
    disconnectSidePanelWindow: vi.fn(),
    forgetSidePanelTab: vi.fn(async () => undefined),
    forgetSidePanelWindow: vi.fn(async () => undefined),
    handleOpenInSplitClick: vi.fn(),
    handleSidePanelTabActivated: mocks.handleActivated,
    handleSidePanelTabAttached: vi.fn(async () => undefined),
    handleSidePanelTabReplaced: vi.fn(async () => undefined),
    handleSidePanelTabUpdated: mocks.handleUpdated,
    normalizeSidePanelContent: vi.fn(async () => undefined),
    reconcileOpenInSplitMenu: vi.fn(async () => undefined),
    sidePanelWindows: {},
}));

vi.mock('../src/background/side-panel-framing', () => ({
    SidePanelFraming: class {
        /** Clears any stale framing rule. */
        async reset(): Promise<void> {
            await Promise.resolve();
        }
    },
}));

vi.mock('../src/background/side-panel-port-controller', () => ({
    SidePanelPortController: class {
        readonly accept = mocks.acceptPort;

        readonly recoverWindow = mocks.recoverWindow;
    },
}));

vi.mock('../src/shared/logger', () => ({
    FOLLOW_DIAGNOSTIC_CODE: {
        TAB_LIFECYCLE_FAILED: 'tab_lifecycle_failed',
    },
    logFollowWarning: mocks.logFollowWarning,
    logWarning: vi.fn(),
}));

const WINDOW_ID = 3;
const TAB_ID = 7;
const EXTENSION_ID = 'extension-id';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

describe('background side-panel readiness recovery', () => {
    beforeAll(async () => {
        const { events } = mocks;
        vi.stubGlobal('chrome', {
            contextMenus: { onClicked: events.contextMenuClicked },
            declarativeNetRequest: {},
            runtime: {
                id: EXTENSION_ID,
                getURL: vi.fn((path: string) => `${EXTENSION_ORIGIN}/${path}`),
                onConnect: events.runtimeConnect,
                onMessage: events.runtimeMessage,
            },
            tabs: {
                onActivated: events.tabActivated,
                onAttached: events.tabAttached,
                onDetached: events.tabDetached,
                onRemoved: events.tabRemoved,
                onReplaced: events.tabReplaced,
                onUpdated: events.tabUpdated,
            },
            windows: { onRemoved: events.windowRemoved },
        });
        await import('../src/background');
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('requests recovery only after a successful live activation', async () => {
        mocks.handleActivated.mockResolvedValueOnce({
            revision: 4,
            content: { tabId: TAB_ID },
        });

        mocks.events.tabActivated.emit({ tabId: TAB_ID, windowId: WINDOW_ID } as never);

        await vi.waitFor(() => {
            expect(mocks.recoverWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        });
    });

    it('does not request activation recovery without a live projection', async () => {
        mocks.handleActivated.mockResolvedValueOnce(null);

        mocks.events.tabActivated.emit({ tabId: TAB_ID, windowId: WINDOW_ID } as never);
        await Promise.resolve();

        expect(mocks.recoverWindow).not.toHaveBeenCalled();
    });

    it('requests recovery only for a successful authoritative update', async () => {
        mocks.handleUpdated.mockResolvedValueOnce(true);

        mocks.events.tabUpdated.emit(
            TAB_ID as never,
            { status: 'complete' } as never,
            { active: true, windowId: WINDOW_ID } as never,
        );

        await vi.waitFor(() => {
            expect(mocks.recoverWindow).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
        });
    });

    it('does not request update recovery for a non-authoritative result', async () => {
        mocks.handleUpdated.mockResolvedValueOnce(false);

        mocks.events.tabUpdated.emit(
            TAB_ID as never,
            { status: 'complete' } as never,
            { active: false, windowId: WINDOW_ID } as never,
        );
        await Promise.resolve();

        expect(mocks.recoverWindow).not.toHaveBeenCalled();
    });
});

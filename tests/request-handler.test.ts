import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import { BACKGROUND_REQUEST_TYPE } from '../src/shared/messages';

const mocks = vi.hoisted(() => ({
    tabsGet: vi.fn(),
    getFollow: vi.fn(),
    reserve: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    check: vi.fn(),
    enableFollow: vi.fn(),
    setFollow: vi.fn(),
}));

vi.mock('../src/background/chrome-adapters', () => ({
    getArticleClickDiscussionEnabled: vi.fn(),
    getAutomaticAvailabilityEnabled: vi.fn(),
    getSidePanelFollowEnabled: mocks.getFollow,
    getSidePanelContent: vi.fn(),
    sessionStore: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
    },
    tabs: {
        get: mocks.tabsGet,
        create: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../src/background/article-click-controller', () => ({
    setArticleClickSetting: vi.fn(),
}));

vi.mock('../src/background/article-lookup', () => ({
    lookupArticle: vi.fn(),
}));

vi.mock('../src/background/automatic-availability-controller', () => ({
    setAutomaticAvailability: vi.fn(),
}));

vi.mock('../src/background/side-panel-content-controller', () => ({
    reserveSidePanelExplicitOperation: mocks.reserve,
    cancelSidePanelExplicitOperation: mocks.cancel,
    selectSidePanelDiscussion: mocks.select,
}));

vi.mock('../src/background/side-panel-follow-controller', () => ({
    checkActiveSidePanelTab: mocks.check,
    enableSidePanelFollow: mocks.enableFollow,
    setSidePanelFollowSetting: mocks.setFollow,
}));

import { handleRequest } from '../src/background/request-handler';

const TAB_ID = 7;
const WINDOW_ID = 3;
const OTHER_WINDOW_ID = 4;
const ITEM_ID = '424242';
const SOURCE_URL = 'https://example.com/story';

const request = {
    type: BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION,
    tabId: TAB_ID,
    windowId: WINDOW_ID,
    itemId: ITEM_ID,
    sourceUrl: SOURCE_URL,
} as const;

describe('side panel selection request ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reserve.mockReturnValue({
            tabId: TAB_ID,
            token: 1,
            readiness: Promise.resolve(null),
            completion: Promise.resolve(null),
        });
        mocks.select.mockResolvedValue({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            tabId: TAB_ID,
            itemId: ITEM_ID,
        });
        mocks.getFollow.mockResolvedValue(false);
        mocks.setFollow.mockImplementation(async (enabled: boolean) => enabled);
        mocks.check.mockResolvedValue({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
        mocks.enableFollow.mockResolvedValue({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            tabId: TAB_ID,
            itemId: ITEM_ID,
        });
    });

    it.each([
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING },
            operation: mocks.getFollow,
            result: { enabled: false },
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING,
                enabled: true,
            },
            operation: mocks.setFollow,
            result: { enabled: true },
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
                windowId: WINDOW_ID,
            },
            operation: mocks.check,
            result: {
                content: {
                    kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
                    tabId: TAB_ID,
                },
            },
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW,
                windowId: WINDOW_ID,
            },
            operation: mocks.enableFollow,
            result: {
                content: {
                    kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
                    tabId: TAB_ID,
                    itemId: ITEM_ID,
                },
            },
        },
    ])('routes $request.type through its independent owner', async ({
        request: followRequest,
        operation,
        result,
    }) => {
        await expect(handleRequest(followRequest)).resolves.toEqual({ ok: true, result });

        expect(operation).toHaveBeenCalledOnce();
    });

    it.each([
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING },
            operation: mocks.getFollow,
            error: 'setting_read_failed',
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING,
                enabled: false,
            },
            operation: mocks.setFollow,
            error: 'setting_update_failed',
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB,
                windowId: WINDOW_ID,
            },
            operation: mocks.check,
            error: 'side_panel_selection_failed',
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW,
                windowId: WINDOW_ID,
            },
            operation: mocks.enableFollow,
            error: 'setting_update_failed',
        },
    ])('maps $request.type failures to $error', async ({
        request: followRequest,
        operation,
        error,
    }) => {
        operation.mockRejectedValueOnce(new Error('private details'));

        await expect(handleRequest(followRequest)).resolves.toEqual({ ok: false, error });
    });

    it('reserves first, validates current ownership, and forwards the source URL', async () => {
        let resolveTab: (tab: { windowId: number }) => void = () => undefined;
        mocks.tabsGet.mockReturnValue(new Promise((resolve) => {
            resolveTab = resolve;
        }));

        const response = handleRequest(request);

        expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(WINDOW_ID, TAB_ID);
        expect(mocks.select).not.toHaveBeenCalled();
        resolveTab({ windowId: WINDOW_ID });

        await expect(response).resolves.toEqual({
            ok: true,
            result: {
                content: {
                    kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
                    tabId: TAB_ID,
                    itemId: ITEM_ID,
                },
            },
        });
        expect(mocks.tabsGet).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            itemId: ITEM_ID,
            sourceUrl: SOURCE_URL,
        }));
        expect(mocks.cancel).not.toHaveBeenCalled();
    });

    it('cancels and rejects a request whose tab moved to another window', async () => {
        mocks.tabsGet.mockResolvedValue({ windowId: OTHER_WINDOW_ID });

        await expect(handleRequest(request)).resolves.toEqual({
            ok: false,
            error: 'side_panel_selection_failed',
        });

        expect(mocks.select).not.toHaveBeenCalled();
        expect(mocks.cancel).toHaveBeenCalledWith(
            WINDOW_ID,
            expect.objectContaining({ tabId: TAB_ID, token: 1 }),
            true,
        );
    });
});

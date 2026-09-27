import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';

import { handleRequest } from '../src/background/request-handler';
import { BACKGROUND_REQUEST_TYPE } from '../src/shared/messages';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';

const mocks = vi.hoisted(() => ({
    tabsGet: vi.fn(),
    tabsCreate: vi.fn(),
    tabsUpdate: vi.fn(),
    sessionGet: vi.fn(),
    sessionSet: vi.fn(),
    sessionRemove: vi.fn(),
    getFollow: vi.fn(),
    reserve: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    check: vi.fn(),
    enableFollow: vi.fn(),
    setFollow: vi.fn(),
    lookupArticle: vi.fn(),
    getAvailability: vi.fn(),
    setAvailability: vi.fn(),
    getArticleClick: vi.fn(),
    setArticleClick: vi.fn(),
    getSidePanelContent: vi.fn(),
}));

vi.mock('../src/background/chrome-adapters', () => ({
    getArticleClickDiscussionEnabled: mocks.getArticleClick,
    getAutomaticAvailabilityEnabled: mocks.getAvailability,
    getSidePanelFollowEnabled: mocks.getFollow,
    getSidePanelContent: mocks.getSidePanelContent,
    sessionStore: {
        get: mocks.sessionGet,
        set: mocks.sessionSet,
        remove: mocks.sessionRemove,
    },
    tabs: {
        get: mocks.tabsGet,
        create: mocks.tabsCreate,
        update: mocks.tabsUpdate,
    },
}));

vi.mock('../src/background/article-click-controller', () => ({
    setArticleClickSetting: mocks.setArticleClick,
}));

vi.mock('../src/background/article-lookup', () => ({
    lookupArticle: mocks.lookupArticle,
}));

vi.mock('../src/background/automatic-availability-controller', () => ({
    setAutomaticAvailability: mocks.setAvailability,
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

describe('handleRequest routing and error mapping', () => {
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
        mocks.lookupArticle.mockResolvedValue({ status: 'not_found' });
        mocks.getAvailability.mockResolvedValue(false);
        mocks.setAvailability.mockImplementation(async (enabled: boolean) => enabled);
        mocks.getArticleClick.mockResolvedValue(false);
        mocks.setArticleClick.mockImplementation(async (enabled: boolean) => enabled);
        mocks.getSidePanelContent.mockResolvedValue(undefined);
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
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.LOOKUP,
                context: { pageUrl: SOURCE_URL, canonicalHref: null },
            },
            operation: mocks.lookupArticle,
            result: { status: 'not_found' },
        },
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING },
            operation: mocks.getAvailability,
            result: { enabled: false },
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
                enabled: true,
            },
            operation: mocks.setAvailability,
            result: { enabled: true },
        },
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING },
            operation: mocks.getArticleClick,
            result: { enabled: false },
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
                enabled: true,
            },
            operation: mocks.setArticleClick,
            result: { enabled: true },
        },
    ])('routes $request.type through its independent owner', async ({
        request: followRequest,
        operation,
        result,
    }) => {
        await expect(handleRequest(followRequest)).resolves.toEqual({ ok: true, result });

        expect(operation).toHaveBeenCalledOnce();
    });

    it('forwards the page URL and canonical href to the lookup owner', async () => {
        await handleRequest({
            type: BACKGROUND_REQUEST_TYPE.LOOKUP,
            context: { pageUrl: SOURCE_URL, canonicalHref: 'https://example.com/canonical' },
        });

        expect(mocks.lookupArticle).toHaveBeenCalledExactlyOnceWith(SOURCE_URL, 'https://example.com/canonical');
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
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.LOOKUP,
                context: { pageUrl: SOURCE_URL, canonicalHref: null },
            },
            operation: mocks.lookupArticle,
            error: 'lookup_request_failed',
        },
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING },
            operation: mocks.getAvailability,
            error: 'setting_read_failed',
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING,
                enabled: true,
            },
            operation: mocks.setAvailability,
            error: 'setting_update_failed',
        },
        {
            request: { type: BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING },
            operation: mocks.getArticleClick,
            error: 'setting_read_failed',
        },
        {
            request: {
                type: BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING,
                enabled: true,
            },
            operation: mocks.setArticleClick,
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

    it('forwards the projected content for an existing side panel projection', async () => {
        mocks.getSidePanelContent.mockResolvedValue({
            content: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId: TAB_ID, itemId: ITEM_ID },
        });

        await expect(handleRequest({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
            windowId: WINDOW_ID,
        })).resolves.toEqual({
            ok: true,
            result: { content: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId: TAB_ID, itemId: ITEM_ID } },
        });
        expect(mocks.getSidePanelContent).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
    });

    it('reports null content when no side panel projection exists for the window', async () => {
        mocks.getSidePanelContent.mockResolvedValue(undefined);

        await expect(handleRequest({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
            windowId: WINDOW_ID,
        })).resolves.toEqual({ ok: true, result: { content: null } });
    });

    it('maps a side panel projection read failure to side_panel_selection_failed', async () => {
        mocks.getSidePanelContent.mockRejectedValueOnce(new Error('private details'));

        await expect(handleRequest({
            type: BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION,
            windowId: WINDOW_ID,
        })).resolves.toEqual({ ok: false, error: 'side_panel_selection_failed' });
    });

    it('opens the requested item id in a new adjacent discussion tab', async () => {
        const NEW_DISCUSSION_TAB_ID = 99;
        mocks.tabsGet.mockResolvedValue({ id: TAB_ID, index: 0, windowId: WINDOW_ID });
        mocks.sessionGet.mockResolvedValue(undefined);
        mocks.tabsCreate.mockResolvedValue({ id: NEW_DISCUSSION_TAB_ID, index: 1, windowId: WINDOW_ID });

        await expect(handleRequest({
            type: BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION,
            articleTabId: TAB_ID,
            itemId: ITEM_ID,
        })).resolves.toEqual({
            ok: true,
            result: { mode: 'adjacent_tab', tabId: NEW_DISCUSSION_TAB_ID },
        });
        expect(mocks.tabsGet).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        expect(mocks.tabsCreate).toHaveBeenCalledExactlyOnceWith({
            active: true,
            index: 1,
            openerTabId: TAB_ID,
            url: `https://news.ycombinator.com/item?id=${ITEM_ID}`,
            windowId: WINDOW_ID,
        });
        expect(mocks.sessionSet).toHaveBeenCalledExactlyOnceWith(TAB_ID, NEW_DISCUSSION_TAB_ID);
    });

    it('maps a failure to open the discussion tab to open_discussion_failed', async () => {
        mocks.tabsGet.mockRejectedValueOnce(new Error('private details'));

        await expect(handleRequest({
            type: BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION,
            articleTabId: TAB_ID,
            itemId: ITEM_ID,
        })).resolves.toEqual({ ok: false, error: 'open_discussion_failed' });
    });
});

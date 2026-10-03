import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { DiscussionTabManager } from '../src/browser/open-discussion';

import type { SessionStore, TabClient, TabSummary } from '../src/browser/open-discussion';

const createStore = (initial?: number): SessionStore & { value?: number } => {
    const store: SessionStore & { value?: number } = {
        ...(initial === undefined ? {} : { value: initial }),
        get: vi.fn(async () => store.value),
        set: vi.fn(async (_articleTabId, discussionTabId) => {
            store.value = discussionTabId;
        }),
        remove: vi.fn(async () => {
            delete store.value;
        }),
    };
    return store;
};

const unexpectedUpdate = (): ReturnType<typeof vi.fn<TabClient['update']>> => {
    return vi.fn<TabClient['update']>(
        async () => {
            throw new Error('update is not expected in this scenario');
        },
    );
};

describe('DiscussionTabManager', () => {
    it('opens the first discussion in a normal adjacent tab', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => ({
                id,
                index: 4,
                windowId: 2,
                splitViewId: -1,
            })),
            create: vi.fn(async () => ({
                id: 91,
                index: 5,
                windowId: 2,
                splitViewId: -1,
            })),
            update: unexpectedUpdate(),
        };
        const store = createStore();
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '123');

        expect(tabs.create).toHaveBeenCalledWith({
            active: true,
            index: 5,
            openerTabId: 40,
            url: 'https://news.ycombinator.com/item?id=123',
            windowId: 2,
        });
        expect(store.set).toHaveBeenCalledWith(40, 91);
        expect(result).toEqual({ mode: 'adjacent_tab', tabId: 91 });
    });

    it('reuses the remembered discussion tab and preserves native Split View', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? {
                        id,
                        index: 4,
                        windowId: 2,
                        splitViewId: 7,
                    }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        splitViewId: 7,
                    }
            )),
            create: vi.fn(),
            update: vi.fn(async (id) => ({
                id,
                index: 5,
                windowId: 2,
                splitViewId: 7,
            })),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '456');

        expect(tabs.update).toHaveBeenCalledWith(91, {
            active: true,
            url: 'https://news.ycombinator.com/item?id=456',
        });
        expect(tabs.create).not.toHaveBeenCalled();
        expect(result).toEqual({ mode: 'split_view', tabId: 91 });
    });

    it('serializes concurrent opens for the same article and creates only one tab', async () => {
        let resolveCreated: ((tab: { id: number; index: number; windowId: number }) => void) | undefined;
        const created = new Promise<{ id: number; index: number; windowId: number }>((resolve) => {
            resolveCreated = resolve;
        });
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? { id, index: 4, windowId: 2 }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        url: 'https://news.ycombinator.com/item?id=123',
                    }
            )),
            create: vi.fn(async () => created),
            update: vi.fn(async (id) => ({ id, index: 5, windowId: 2 })),
        };
        const store = createStore();
        const manager = new DiscussionTabManager(tabs, store);

        const first = manager.open(40, '123');
        const second = manager.open(40, '456');
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        const createsBeforeFirstCompleted = vi.mocked(tabs.create).mock.calls.length;
        resolveCreated?.({ id: 91, index: 5, windowId: 2 });

        await expect(Promise.all([first, second])).resolves.toEqual([
            { mode: 'adjacent_tab', tabId: 91 },
            { mode: 'reused_tab', tabId: 91 },
        ]);
        expect(createsBeforeFirstCompleted).toBe(1);
        expect(tabs.create).toHaveBeenCalledTimes(1);
        expect(tabs.update).toHaveBeenCalledWith(91, {
            active: true,
            url: 'https://news.ycombinator.com/item?id=456',
        });
    });

    it('reuses the remembered tab while it stays on Hacker News', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? {
                        id,
                        index: 4,
                        windowId: 2,
                        splitViewId: -1,
                    }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        splitViewId: -1,
                        url: 'https://news.ycombinator.com/newest',
                    }
            )),
            create: vi.fn(),
            update: vi.fn(async (id) => ({
                id,
                index: 5,
                windowId: 2,
                splitViewId: -1,
            })),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '456');

        expect(tabs.update).toHaveBeenCalledWith(91, {
            active: true,
            url: 'https://news.ycombinator.com/item?id=456',
        });
        expect(tabs.create).not.toHaveBeenCalled();
        expect(result).toEqual({ mode: 'reused_tab', tabId: 91 });
    });

    it('opens a replacement instead of taking over a tab navigated away from Hacker News', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? {
                        id,
                        index: 4,
                        windowId: 2,
                        splitViewId: -1,
                    }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        splitViewId: -1,
                        url: 'https://example.com/somewhere-else',
                    }
            )),
            create: vi.fn(async () => ({
                id: 92,
                index: 5,
                windowId: 2,
                splitViewId: -1,
            })),
            update: unexpectedUpdate(),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '456');

        expect(store.remove).toHaveBeenCalledWith(40);
        expect(store.set).toHaveBeenCalledWith(40, 92);
        expect(result).toEqual({ mode: 'adjacent_tab', tabId: 92 });
    });

    it('keeps reusing a native Split View pane even after it left Hacker News', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? {
                        id,
                        index: 4,
                        windowId: 2,
                        splitViewId: 7,
                    }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        splitViewId: 7,
                        url: 'https://example.com/article',
                    }
            )),
            create: vi.fn(),
            update: vi.fn(async (id) => ({
                id,
                index: 5,
                windowId: 2,
                splitViewId: 7,
            })),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '456');

        expect(tabs.update).toHaveBeenCalledWith(91, {
            active: true,
            url: 'https://news.ycombinator.com/item?id=456',
        });
        expect(tabs.create).not.toHaveBeenCalled();
        expect(result).toEqual({ mode: 'split_view', tabId: 91 });
    });

    it('creates a replacement when the remembered tab no longer exists', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => {
                if (id === 91) {
                    throw new Error('No tab with id');
                }
                return {
                    id,
                    index: 1,
                    windowId: 2,
                    splitViewId: -1,
                };
            }),
            create: vi.fn(async () => ({
                id: 92,
                index: 2,
                windowId: 2,
                splitViewId: -1,
            })),
            update: unexpectedUpdate(),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        const result = await manager.open(40, '789');

        expect(store.remove).toHaveBeenCalledWith(40);
        expect(store.set).toHaveBeenCalledWith(40, 92);
        expect(result).toEqual({ mode: 'adjacent_tab', tabId: 92 });
    });

    it('reports success when the tab opened but remembering the association failed', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => ({
                id,
                index: 4,
                windowId: 2,
                splitViewId: -1,
            })),
            create: vi.fn(async () => ({
                id: 91,
                index: 5,
                windowId: 2,
                splitViewId: -1,
            })),
            update: unexpectedUpdate(),
        };
        const store = createStore();
        vi.mocked(store.set).mockRejectedValue(new Error('session storage unavailable'));
        const manager = new DiscussionTabManager(tabs, store);

        await expect(manager.open(40, '123')).resolves.toEqual({ mode: 'adjacent_tab', tabId: 91 });
        expect(tabs.create).toHaveBeenCalledTimes(1);
    });

    it('still opens a replacement tab when clearing a stale association fails', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => {
                if (id === 91) {
                    throw new Error('No tab with id');
                }
                return {
                    id,
                    index: 1,
                    windowId: 2,
                    splitViewId: -1,
                };
            }),
            create: vi.fn(async () => ({
                id: 92,
                index: 2,
                windowId: 2,
                splitViewId: -1,
            })),
            update: unexpectedUpdate(),
        };
        const store = createStore(91);
        vi.mocked(store.remove).mockRejectedValue(new Error('session storage unavailable'));
        const manager = new DiscussionTabManager(tabs, store);

        await expect(manager.open(40, '789')).resolves.toEqual({ mode: 'adjacent_tab', tabId: 92 });
        expect(store.set).toHaveBeenCalledWith(40, 92);
    });

    it('propagates an update failure and preserves the remembered association', async () => {
        const updateError = new Error('Cannot update tab');
        const tabs: TabClient = {
            get: vi.fn(async (id) => (
                id === 40
                    ? { id, index: 4, windowId: 2 }
                    : {
                        id,
                        index: 5,
                        windowId: 2,
                        url: 'https://news.ycombinator.com/item?id=123',
                    }
            )),
            create: vi.fn(),
            update: vi.fn(async () => Promise.reject(updateError)),
        };
        const store = createStore(91);
        const manager = new DiscussionTabManager(tabs, store);

        await expect(manager.open(40, '789')).rejects.toBe(updateError);

        expect(tabs.create).not.toHaveBeenCalled();
        expect(store.remove).not.toHaveBeenCalled();
        expect(store.value).toBe(91);
    });
});

describe('opt-in native Split View', () => {
    const articleId = 40;
    const discussionId = 91;
    const makeFixture = (remembered = false) => {
        const article: TabSummary = {
            id: articleId,
            index: 4,
            windowId: 2,
            splitViewId: -1,
            pinned: false,
            groupId: -1,
        };
        const discussion: TabSummary = {
            id: discussionId,
            index: 5,
            windowId: 2,
            splitViewId: -1,
            pinned: false,
            groupId: -1,
            url: 'https://news.ycombinator.com/item?id=123',
        };
        const createSplit = vi.fn<TabClient['createSplit'] & object>(async () => 7);
        const tabs: TabClient = {
            get: vi.fn(async (id) => (id === articleId ? article : discussion)),
            create: vi.fn(async () => discussion),
            update: vi.fn(async () => discussion),
            createSplit,
        };
        const store = createStore(remembered ? discussionId : undefined);
        return {

            article,
            discussion,
            tabs,
            store,
            createSplit,
            manager: new DiscussionTabManager(tabs, store),
        };
    };

    it('does not use the native API without explicit opt-in', async () => {
        const { manager, createSplit } = makeFixture();
        await expect(manager.open(articleId, '123')).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(createSplit).not.toHaveBeenCalled();
    });

    it.each([false, true])('pairs one opened discussion, remembered=%s', async (remembered) => {
        const {

            manager,
            tabs,
            store,
            createSplit,
        } = makeFixture(remembered);
        await expect(manager.open(articleId, '456', true)).resolves.toEqual({
            mode: 'split_view',
            tabId: discussionId,
        });
        expect(createSplit).toHaveBeenCalledExactlyOnceWith([articleId, discussionId]);
        expect(tabs.create).toHaveBeenCalledTimes(remembered ? 0 : 1);
        expect(tabs.update).toHaveBeenCalledTimes(remembered ? 1 : 0);
        expect(store.value).toBe(discussionId);
        const opening = remembered ? tabs.update : tabs.create;
        expect(vi.mocked(opening).mock.calls[0]?.at(-1)).toMatchObject({
            url: 'https://news.ycombinator.com/item?id=456',
        });
    });

    it('falls back when the browser has no native adapter', async () => {
        const { manager, tabs } = makeFixture();
        delete tabs.createSplit;
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(tabs.create).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, -1])('keeps one tab when the native adapter returns %s', async (splitId) => {
        const { manager, tabs, createSplit } = makeFixture();
        createSplit.mockResolvedValueOnce(splitId);
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(tabs.create).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('keeps the opened tab when Chrome rejects pairing, remembered=%s', async (remembered) => {
        const {

            manager,
            tabs,
            store,
            createSplit,
        } = makeFixture(remembered);
        createSplit.mockRejectedValueOnce(new Error('Tabs cannot be edited right now'));
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: remembered ? 'reused_tab' : 'adjacent_tab',
            tabId: discussionId,
        });
        expect(tabs.create).toHaveBeenCalledTimes(remembered ? 0 : 1);
        expect(store.value).toBe(discussionId);
    });

    it('keeps the opened discussion when tab revalidation fails', async () => {
        const { manager, tabs, createSplit } = makeFixture();
        vi.mocked(tabs.get).mockResolvedValueOnce({ id: articleId, index: 4, windowId: 2 })
            .mockRejectedValueOnce(new Error('Article closed'));
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(createSplit).not.toHaveBeenCalled();
        expect(tabs.create).toHaveBeenCalledTimes(1);
    });

    it.each([
        { splitViewId: 8 },
        { windowId: 3 },
        { index: 8 },
        { pinned: true },
        { groupId: 2 },
    ])('does not rearrange or split an incompatible discussion: %j', async (change) => {
        const { manager, discussion, createSplit } = makeFixture();
        Object.assign(discussion, change);
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(createSplit).not.toHaveBeenCalled();
    });

    it("does not replace the article's existing unrelated split", async () => {
        const { manager, article, createSplit } = makeFixture();
        article.splitViewId = 8;
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'adjacent_tab',
            tabId: discussionId,
        });
        expect(createSplit).not.toHaveBeenCalled();
    });

    it('recognizes a pairing made by the user while the discussion is being opened', async () => {
        const {

            manager,
            article,
            discussion,
            tabs,
            createSplit,
        } = makeFixture();
        vi.mocked(tabs.create).mockImplementationOnce(async () => {
            article.splitViewId = 7;
            discussion.splitViewId = 7;
            return discussion;
        });
        await expect(manager.open(articleId, '123', true)).resolves.toEqual({
            mode: 'split_view',
            tabId: discussionId,
        });
        expect(createSplit).not.toHaveBeenCalled();
    });
});

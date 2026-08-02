import { describe, expect, it, vi } from 'vitest';

import { openDiscussion } from '../src/browser/openDiscussion';
import type { SessionStore, TabClient } from '../src/browser/openDiscussion';

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

describe('openDiscussion', () => {
    it('opens the first discussion in a normal adjacent tab', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => ({ id, index: 4, windowId: 2, splitViewId: -1 })),
            create: vi.fn(async () => ({ id: 91, index: 5, windowId: 2, splitViewId: -1 })),
            update: vi.fn(),
        };
        const store = createStore();

        const result = await openDiscussion(40, '123', tabs, store);

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
                    ? { id, index: 4, windowId: 2, splitViewId: 7 }
                    : { id, index: 5, windowId: 2, splitViewId: 7 }
            )),
            create: vi.fn(),
            update: vi.fn(async (id) => ({ id, index: 5, windowId: 2, splitViewId: 7 })),
        };
        const store = createStore(91);

        const result = await openDiscussion(40, '456', tabs, store);

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
                    : { id, index: 5, windowId: 2 }
            )),
            create: vi.fn(async () => created),
            update: vi.fn(async (id) => ({ id, index: 5, windowId: 2 })),
        };
        const store = createStore();

        const first = openDiscussion(40, '123', tabs, store);
        const second = openDiscussion(40, '456', tabs, store);
        await new Promise((resolve) => setTimeout(resolve, 0));
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

    it('creates a replacement when the remembered tab no longer exists', async () => {
        const tabs: TabClient = {
            get: vi.fn(async (id) => {
                if (id === 91) {
                    throw new Error('No tab with id');
                }
                return { id, index: 1, windowId: 2, splitViewId: -1 };
            }),
            create: vi.fn(async () => ({ id: 92, index: 2, windowId: 2, splitViewId: -1 })),
            update: vi.fn(),
        };
        const store = createStore(91);

        const result = await openDiscussion(40, '789', tabs, store);

        expect(store.remove).toHaveBeenCalledWith(40);
        expect(store.set).toHaveBeenCalledWith(40, 92);
        expect(result).toEqual({ mode: 'adjacent_tab', tabId: 92 });
    });

    it('propagates an update failure and preserves the remembered association', async () => {
        const updateError = new Error('Cannot update tab');
        const tabs: TabClient = {
            get: vi.fn(async (id) => ({ id, index: id === 40 ? 4 : 5, windowId: 2 })),
            create: vi.fn(),
            update: vi.fn(async () => Promise.reject(updateError)),
        };
        const store = createStore(91);

        await expect(openDiscussion(40, '789', tabs, store)).rejects.toBe(updateError);

        expect(tabs.create).not.toHaveBeenCalled();
        expect(store.remove).not.toHaveBeenCalled();
        expect(store.value).toBe(91);
    });
});

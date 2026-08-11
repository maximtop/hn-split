import { describe, expect, it, vi } from 'vitest';

import {
    SidePanelAssociationStore,
} from '../src/browser/side-panel-association-store';
import type {
    SidePanelAssociationStorage,
} from '../src/browser/side-panel-association-store';
import {
    SIDE_PANEL_ASSOCIATION_ORIGIN,
} from '../src/shared/side-panel-association';
import type { SidePanelAssociation } from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import { sidePanelAssociationKey } from '../src/shared/storage-keys';

const TAB_ID = 7;
const WINDOW_ID = 3;
const ITEM_ID = '424242';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
}

/**
 * Creates a controllable promise for FIFO storage tests.
 * @returns The promise and its external settlement functions.
 */
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

/**
 * Creates one valid reusable discussion association.
 * @param overrides - Fields that distinguish the test association.
 * @returns A strict session association.
 */
function discussionAssociation(
    overrides: Partial<SidePanelAssociation> = {},
): SidePanelAssociation {
    return {
        tabId: TAB_ID,
        windowId: WINDOW_ID,
        origin: SIDE_PANEL_ASSOCIATION_ORIGIN.MANUAL,
        outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
        articleIdentity: 'example.com/story',
        ...overrides,
    };
}

/**
 * Creates an observable in-memory association storage adapter.
 * @returns The backing map and mocked storage boundary.
 */
function memoryStorage(): {
    memory: Map<string, unknown>;
    storage: SidePanelAssociationStorage;
} {
    const memory = new Map<string, unknown>();
    const storage: SidePanelAssociationStorage = {
        get: vi.fn(async (key) => memory.get(key)),
        getAll: vi.fn(async () => Object.fromEntries(memory)),
        set: vi.fn(async (key, value) => { memory.set(key, value); }),
        remove: vi.fn(async (key) => { memory.delete(key); }),
    };
    return { memory, storage };
}

describe('SidePanelAssociationStore', () => {
    it('round trips strict keyed associations and removes the exact key', async () => {
        const { storage } = memoryStorage();
        const store = new SidePanelAssociationStore(storage);
        const association = discussionAssociation();

        await store.set(association);
        await expect(store.get(TAB_ID)).resolves.toEqual(association);
        await store.remove(TAB_ID);

        expect(storage.remove).toHaveBeenCalledExactlyOnceWith(sidePanelAssociationKey(TAB_ID));
        await expect(store.get(TAB_ID)).resolves.toBeNull();
    });

    it('filters mismatched, corrupt, and raw records from reads and listings', async () => {
        const { memory, storage } = memoryStorage();
        const store = new SidePanelAssociationStore(storage);
        const association = discussionAssociation();
        memory.set(sidePanelAssociationKey(TAB_ID), { ...association, tabId: TAB_ID + 1 });
        memory.set(sidePanelAssociationKey(9), { rawUrl: 'https://example.com/private' });
        memory.set('unrelated', association);

        await expect(store.get(TAB_ID)).resolves.toBeNull();
        await expect(store.list()).resolves.toEqual([]);
    });

    it('rejects malformed values and cross-tab set decisions before storage', async () => {
        const { storage } = memoryStorage();
        const store = new SidePanelAssociationStore(storage);
        const malformed = {
            ...discussionAssociation(),
            rawUrl: 'https://example.com/private',
        } as SidePanelAssociation;

        await expect(store.set(malformed)).rejects.toThrow(TypeError);
        await expect(store.mutate(TAB_ID, () => ({
            kind: 'set',
            association: discussionAssociation({ tabId: TAB_ID + 1 }),
        }))).rejects.toThrow(TypeError);
        expect(storage.set).not.toHaveBeenCalled();
    });

    it('blocks settled reads behind a delayed mutation', async () => {
        const { memory, storage } = memoryStorage();
        const writeGate = deferred<void>();
        vi.mocked(storage.set).mockImplementationOnce(async (key, value) => {
            await writeGate.promise;
            memory.set(key, value);
        });
        const store = new SidePanelAssociationStore(storage);
        const association = discussionAssociation();

        const writing = store.mutate(TAB_ID, () => ({ kind: 'set', association }));
        const observedRead = store.settledGet(TAB_ID);
        let readSettled = false;
        void observedRead.finally(() => {
            readSettled = true;
        });
        await Promise.resolve();

        expect(readSettled).toBe(false);
        writeGate.resolve();
        await writing;
        await expect(observedRead).resolves.toEqual(association);
    });

    it('serializes removal before a destination-window set for the same tab', async () => {
        const { storage } = memoryStorage();
        const store = new SidePanelAssociationStore(storage);
        const association = discussionAssociation();
        await store.set(association);

        const removal = store.mutate(TAB_ID, () => ({ kind: 'remove' }));
        const movedAssociation = discussionAssociation({ windowId: 9 });
        const destinationSet = store.mutate(TAB_ID, () => ({
            kind: 'set',
            association: movedAssociation,
        }));
        await Promise.all([removal, destinationSet]);

        await expect(store.settledGet(TAB_ID)).resolves.toEqual(movedAssociation);
    });

    it('continues after a rejected mutation and does not block another tab queue', async () => {
        const { storage } = memoryStorage();
        const store = new SidePanelAssociationStore(storage);
        const firstGate = deferred<void>();
        const secondAssociation = discussionAssociation({ tabId: 8 });
        vi.mocked(storage.set).mockImplementationOnce(async () => firstGate.promise);

        const delayed = store.mutate(TAB_ID, () => ({
            kind: 'set',
            association: discussionAssociation(),
        }));
        await expect(store.mutate(8, () => ({
            kind: 'set',
            association: secondAssociation,
        }))).resolves.toEqual(secondAssociation);
        firstGate.reject(new Error('session storage unavailable'));
        await expect(delayed).rejects.toThrow('session storage unavailable');

        await expect(store.mutate(TAB_ID, () => ({ kind: 'remove' }))).resolves.toBeNull();
    });
});

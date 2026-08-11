import { describe, expect, it, vi } from 'vitest';

import type { PanelLookupResult } from '../src/background/article-lookup';
import type { SidePanelAssociationMutation } from '../src/browser/side-panel-association-store';
import {
    SidePanelContentManager,
} from '../src/browser/side-panel-content-manager';
import type {
    SidePanelContentDependencies,
} from '../src/browser/side-panel-content-manager';
import { HN_LOOKUP_STATUS } from '../src/domain/hn';
import { normalizeArticleUrl } from '../src/domain/url';
import {
    SIDE_PANEL_ASSOCIATION_ORIGIN,
} from '../src/shared/side-panel-association';
import type {
    SidePanelAssociation,
} from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelContent } from '../src/shared/side-panel-content';
import type { SidePanelProjection } from '../src/shared/side-panel-projection';
import { FOLLOW_DIAGNOSTIC_CODE } from '../src/shared/logger';

const ITEM_ID = '424242';
const OTHER_ITEM_ID = '515151';
const THIRD_ITEM_ID = '616161';
const LINK_URL = 'https://example.com/story';
const OTHER_LINK_URL = 'https://example.com/other';
const THIRD_LINK_URL = 'https://example.com/third';
const RESTRICTED_LINK_URL = 'http://localhost/story';
const ARTICLE_IDENTITY = 'example.com/story';
const OTHER_ARTICLE_IDENTITY = 'example.com/other';
const THIRD_ARTICLE_IDENTITY = 'example.com/third';
const SECRET_SENTINEL_URL = 'https://example.com/story?token=do-not-inspect';
const TAB_ID = 7;
const OTHER_TAB_ID = 8;
const THIRD_TAB_ID = 9;
const WINDOW_ID = 1;
const OTHER_WINDOW_ID = 2;

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve(value: Value): void;
    reject(reason?: unknown): void;
}

interface AssociationHarness {
    values: Map<number, SidePanelAssociation>;
    operations: string[];
    settledGet: ReturnType<typeof vi.fn<(tabId: number) => Promise<SidePanelAssociation | null>>>;
    mutate: ReturnType<typeof vi.fn<(
        tabId: number,
        operation: (
            current: SidePanelAssociation | null,
        ) => Promise<SidePanelAssociationMutation> | SidePanelAssociationMutation,
    ) => Promise<SidePanelAssociation | null>>>;
    delayNextSet(delay: Promise<void>): void;
}

interface DependencyOptions {
    follow?: boolean;
    storedProjection?: SidePanelProjection | null;
    lookup?: (url: string, signal: AbortSignal) => Promise<PanelLookupResult>;
    tabWindow?: number | null;
}

interface DependencyHarness extends SidePanelContentDependencies {
    associations: AssociationHarness;
    writes: SidePanelProjection[];
    storedProjection: SidePanelProjection | null;
    normalizeArticleUrl: ReturnType<typeof vi.fn<(url: string) => string | null>>;
}

/**
 * Creates a manually controlled promise for concurrency tests.
 */
function deferred<Value>(): Deferred<Value> {
    let resolve: (value: Value) => void = () => undefined;
    let reject: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/**
 * Builds one found panel lookup result.
 */
function foundPanelResult(
    itemId = ITEM_ID,
    articleIdentity = ARTICLE_IDENTITY,
): PanelLookupResult {
    return {
        result: {
            status: HN_LOOKUP_STATUS.FOUND,
            primary: {
                id: itemId,
                title: 'Primary discussion',
                articleUrl: LINK_URL,
                comments: 10,
                points: 20,
                createdAt: 1,
            },
            alternatives: [],
        },
        articleIdentity,
    };
}

/**
 * Builds one strict revisioned panel projection.
 */
function projection(revision: number, content: SidePanelContent): SidePanelProjection {
    return { revision, content };
}

/**
 * Builds discussion content owned by one tab.
 */
function discussionContent(tabId = TAB_ID, itemId = ITEM_ID): SidePanelContent {
    return { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId, itemId };
}

/**
 * Builds a reusable found association.
 */
function discussionAssociation(
    tabId = TAB_ID,
    windowId = WINDOW_ID,
    itemId = ITEM_ID,
): SidePanelAssociation {
    return {
        tabId,
        windowId,
        origin: SIDE_PANEL_ASSOCIATION_ORIGIN.AUTOMATIC,
        outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId },
        articleIdentity: tabId === TAB_ID ? ARTICLE_IDENTITY : OTHER_ARTICLE_IDENTITY,
    };
}

/**
 * Creates a process-wide-style per-tab FIFO association fake.
 */
function associationHarness(initial: SidePanelAssociation[] = []): AssociationHarness {
    const values = new Map(initial.map((association) => [association.tabId, association]));
    const operations: string[] = [];
    const tails = new Map<number, Promise<void>>();
    let delayedSet: Promise<void> | null = null;
    const settledGet = vi.fn(async (tabId: number) => {
        await (tails.get(tabId) ?? Promise.resolve()).catch(() => undefined);
        return values.get(tabId) ?? null;
    });
    const mutate = vi.fn(async (
        tabId: number,
        operation: (
            current: SidePanelAssociation | null,
        ) => Promise<SidePanelAssociationMutation> | SidePanelAssociationMutation,
    ) => {
        let result: SidePanelAssociation | null = null;
        const previous = tails.get(tabId) ?? Promise.resolve();
        const mutation = previous.catch(() => undefined).then(async () => {
            const decision = await operation(values.get(tabId) ?? null);
            operations.push(decision.kind);
            if (decision.kind === 'keep') {
                result = values.get(tabId) ?? null;
                return;
            }
            if (decision.kind === 'remove') {
                values.delete(tabId);
                return;
            }
            const wait = delayedSet;
            delayedSet = null;
            if (wait !== null) {
                await wait;
            }
            values.set(tabId, decision.association);
            result = decision.association;
        });
        tails.set(tabId, mutation);
        await mutation;
        return result;
    });
    return {
        values,
        operations,
        settledGet,
        mutate,
        delayNextSet(delay) {
            delayedSet = delay;
        },
    };
}

/**
 * Builds observable manager dependencies.
 */
function dependencies(options: DependencyOptions = {}): DependencyHarness {
    const writes: SidePanelProjection[] = [];
    const associations = associationHarness();
    const harness: DependencyHarness = {
        associations,
        writes,
        storedProjection: options.storedProjection ?? null,
        readProjection: vi.fn(async () => harness.storedProjection),
        writeProjection: vi.fn(async (nextProjection: SidePanelProjection) => {
            writes.push(nextProjection);
            harness.storedProjection = nextProjection;
        }),
        isFollowEnabled: vi.fn(async () => options.follow ?? false),
        lookup: vi.fn(options.lookup ?? (async (url: string) => foundPanelResult(
            url === OTHER_LINK_URL ? OTHER_ITEM_ID : ITEM_ID,
            url === OTHER_LINK_URL ? OTHER_ARTICLE_IDENTITY : ARTICLE_IDENTITY,
        ))),
        getTabWindow: vi.fn(async () => options.tabWindow === undefined
            ? WINDOW_ID
            : options.tabWindow),
        normalizeArticleUrl: vi.fn(normalizeArticleUrl),
        openSidePanel: vi.fn(async () => undefined),
        navigate: vi.fn(async () => undefined),
        resynchronize: vi.fn(async () => undefined),
        discardFrame: vi.fn(),
        target: vi.fn(),
        warn: vi.fn(),
    };
    return harness;
}

describe('SidePanelContentManager synchronization', () => {
    it('publishes manual-required without reading a URL when follow is disabled', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const readUrl = vi.fn(async () => LINK_URL);

        const result = await manager.activate(TAB_ID, readUrl);

        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.discardFrame).not.toHaveBeenCalled();
        expect(deps.target).toHaveBeenCalledExactlyOnceWith(TAB_ID, 1);
        expect(result.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
        expect(deps.writes.at(-1)?.content).toEqual(result.content);
    });

    it('converges on C in one hundred controlled A to B to C races', async () => {
        for (let iteration = 0; iteration < 100; iteration += 1) {
            const a = deferred<PanelLookupResult>();
            const b = deferred<PanelLookupResult>();
            const deps = dependencies({ follow: true });
            vi.mocked(deps.lookup)
                .mockReturnValueOnce(a.promise)
                .mockReturnValueOnce(b.promise)
                .mockResolvedValueOnce(foundPanelResult(
                    THIRD_ITEM_ID,
                    THIRD_ARTICLE_IDENTITY,
                ));
            const manager = new SidePanelContentManager(WINDOW_ID, deps);

            const operationA = manager.activate(TAB_ID, async () => LINK_URL);
            await vi.waitFor(() => {
                expect(deps.lookup).toHaveBeenCalledTimes(1);
            }, { interval: 1 });
            const operationB = manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);
            await vi.waitFor(() => {
                expect(deps.lookup).toHaveBeenCalledTimes(2);
            }, { interval: 1 });
            const operationC = manager.activate(THIRD_TAB_ID, async () => THIRD_LINK_URL);
            await vi.waitFor(() => {
                expect(deps.lookup).toHaveBeenCalledTimes(3);
            }, { interval: 1 });
            b.resolve(foundPanelResult(OTHER_ITEM_ID, OTHER_ARTICLE_IDENTITY));
            a.resolve(foundPanelResult(ITEM_ID, ARTICLE_IDENTITY));

            const settled = await Promise.allSettled([operationA, operationB, operationC]);

            expect(settled[2]).toMatchObject({ status: 'fulfilled' });
            expect(deps.writes.at(-1)?.content).toEqual(
                discussionContent(THIRD_TAB_ID, THIRD_ITEM_ID),
            );
        }
    });

    it('recovers after a rejected projection write without persisting reuse', async () => {
        const deps = dependencies();
        vi.mocked(deps.writeProjection).mockRejectedValueOnce(new Error('session unavailable'));
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await expect(manager.restoreOrCheck(TAB_ID, async () => LINK_URL))
            .rejects.toThrow('session unavailable');

        expect(deps.associations.values.size).toBe(0);
        expect(deps.lookup).not.toHaveBeenCalled();

        const retried = await manager.restoreOrCheck(TAB_ID, async () => LINK_URL);

        expect(retried.content).toEqual(discussionContent());
        expect(deps.associations.values.get(TAB_ID)?.outcome).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
    });

    it('retries a recoverable manual lookup error instead of reusing it', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(foundPanelResult());
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const readUrl = vi.fn(async () => LINK_URL);

        const failed = await manager.restoreOrCheck(TAB_ID, readUrl);

        expect(failed.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: TAB_ID,
            reason: HN_LOOKUP_STATUS.ERROR,
        });
        expect(deps.associations.values.has(TAB_ID)).toBe(false);

        const retried = await manager.restoreOrCheck(TAB_ID, readUrl);

        expect(retried.content).toEqual(discussionContent());
        expect(readUrl).toHaveBeenCalledTimes(2);
        expect(deps.lookup).toHaveBeenCalledTimes(2);
    });

    it('does not publish manual-required after the tab leaves its window', async () => {
        const deps = dependencies({ follow: false, tabWindow: null });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await expect(manager.activate(TAB_ID, async () => LINK_URL))
            .rejects.toMatchObject({ name: 'AbortError' });

        expect(deps.writes.at(-1)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: TAB_ID,
        });
    });

    it('restores an unchanged association before consulting follow or the URL', async () => {
        const deps = dependencies();
        deps.associations.values.set(TAB_ID, discussionAssociation());
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const readUrl = vi.fn(async () => LINK_URL);

        const result = await manager.activate(TAB_ID, readUrl);

        expect(deps.isFollowEnabled).not.toHaveBeenCalled();
        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(result.content).toEqual(discussionContent());
    });

    it('hides the old tab immediately and resolves only the latest enabled activation', async () => {
        const first = deferred<PanelLookupResult>();
        const deps = dependencies({ follow: true });
        vi.mocked(deps.lookup)
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce(foundPanelResult(OTHER_ITEM_ID, OTHER_ARTICLE_IDENTITY));
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const activationA = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);
        const activationB = manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);
        first.resolve(foundPanelResult());
        const [oldResult, latestResult] = await Promise.allSettled([activationA, activationB]);

        expect(oldResult).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
        expect(latestResult).toMatchObject({ status: 'fulfilled' });
        expect(deps.target).toHaveBeenLastCalledWith(OTHER_TAB_ID, expect.any(Number));
        expect(deps.writes.at(-1)?.content).toEqual(discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID));
        expect(deps.writes.slice(1)).not.toContainEqual(expect.objectContaining({
            content: discussionContent(TAB_ID, ITEM_ID),
        }));
    });

    it('announces a new target before an older projection write can finish', async () => {
        const oldWrite = deferred<void>();
        const deps = dependencies({ follow: true });
        vi.mocked(deps.writeProjection).mockImplementationOnce(async (nextProjection) => {
            deps.writes.push(nextProjection);
            await oldWrite.promise;
            deps.storedProjection = nextProjection;
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const first = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => deps.writes.length).toBe(1);

        const second = manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);
        await expect.poll(() => vi.mocked(deps.target).mock.calls.length).toBe(2);

        expect(deps.target).toHaveBeenLastCalledWith(OTHER_TAB_ID, expect.any(Number));
        oldWrite.resolve();
        await Promise.allSettled([first, second]);
        expect(deps.writes.at(-1)?.content).toEqual(discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID));
    });

    it('continues projection revisions after a service-worker manager restart', async () => {
        const deps = dependencies({
            storedProjection: projection(41, discussionContent()),
            follow: false,
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);

        expect(deps.target).toHaveBeenCalledWith(OTHER_TAB_ID, 42);
        expect(result.revision).toBe(43);
        expect(deps.writes.every(({ revision }) => revision > 41)).toBe(true);
    });

    it('hydrates before a cold one-shot manual check allocates its first revision', async () => {
        const deps = dependencies({
            storedProjection: projection(50, discussionContent()),
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.restoreOrCheck(OTHER_TAB_ID, async () => OTHER_LINK_URL);

        expect(deps.target).toHaveBeenCalledWith(OTHER_TAB_ID, 51);
        expect(result.revision).toBe(52);
        expect(deps.writes.every(({ revision }) => revision > 50)).toBe(true);
    });

    it('turns an in-flight automatic check into manual-required without an association', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies({ follow: true, lookup: async () => lookup.promise });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);

        await manager.disableAutomatic();
        lookup.resolve(foundPanelResult());

        await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.writes.at(-1)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
    });

    it('turns off automatic work before its pending projection write settles', async () => {
        const pendingWrite = deferred<void>();
        const deps = dependencies({ follow: true });
        vi.mocked(deps.writeProjection).mockImplementationOnce(async (nextProjection) => {
            deps.writes.push(nextProjection);
            await pendingWrite.promise;
            deps.storedProjection = nextProjection;
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => deps.writes.length).toBe(1);

        const disabling = manager.disableAutomatic();
        pendingWrite.resolve();
        await disabling;

        await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.writes.at(-1)?.content.kind).toBe(SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED);
    });

    it('preserves a displayed result and its queued association when follow is disabled', async () => {
        const associationWrite = deferred<void>();
        const deps = dependencies({ follow: true });
        deps.associations.delayNextSet(associationWrite.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => deps.writes.at(-1)?.content.kind)
            .toBe(SIDE_PANEL_CONTENT_KIND.DISCUSSION);

        await manager.disableAutomatic();
        associationWrite.resolve();
        await activation;

        expect(deps.writes.at(-1)?.content.kind).toBe(SIDE_PANEL_CONTENT_KIND.DISCUSSION);
        expect(deps.associations.values.get(TAB_ID)?.outcome).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
    });

    it('waits for a displayed association write before restoring a rapidly revisited tab', async () => {
        const associationWrite = deferred<void>();
        const deps = dependencies({ follow: true });
        deps.associations.delayNextSet(associationWrite.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const readFirstUrl = vi.fn(async () => LINK_URL);
        const first = manager.activate(TAB_ID, readFirstUrl);
        await expect.poll(() => deps.writes.at(-1)?.content.kind)
            .toBe(SIDE_PANEL_CONTENT_KIND.DISCUSSION);
        await manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);
        const readReturningUrl = vi.fn(async () => LINK_URL);
        const returning = manager.activate(TAB_ID, readReturningUrl);
        associationWrite.resolve();
        await Promise.all([first, returning]);

        expect(readFirstUrl).toHaveBeenCalledOnce();
        expect(readReturningUrl).not.toHaveBeenCalled();
        expect(deps.lookup).toHaveBeenCalledTimes(2);
        expect(deps.writes.at(-1)?.content).toEqual(discussionContent());
    });

    it('queues tab removal after an already-started association write', async () => {
        const associationWrite = deferred<void>();
        const deps = dependencies({ follow: true });
        deps.associations.delayNextSet(associationWrite.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => deps.writes.at(-1)?.content.kind)
            .toBe(SIDE_PANEL_CONTENT_KIND.DISCUSSION);

        const forgetting = manager.forgetTab(TAB_ID);
        associationWrite.resolve();
        await Promise.all([activation, forgetting]);

        expect(deps.associations.operations).toEqual(['set', 'remove']);
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.discardFrame).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    });

    it('reserves the association mutation before a delayed ownership check', async () => {
        const ownership = deferred<number | null>();
        const deps = dependencies({ follow: true });
        vi.mocked(deps.getTabWindow)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockReturnValueOnce(ownership.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.getTabWindow).mock.calls.length).toBe(3);

        const forgetting = manager.forgetTab(TAB_ID);
        ownership.resolve(WINDOW_ID);
        await Promise.all([activation, forgetting]);

        expect(deps.associations.operations).toEqual(['set', 'remove']);
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('fails closed when the tab leaves its owning window before lookup completes', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies({ follow: true, lookup: async () => lookup.promise });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);
        vi.mocked(deps.getTabWindow).mockResolvedValueOnce(null);

        lookup.resolve(foundPanelResult());

        await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.writes.at(-1)?.content.kind).toBe(SIDE_PANEL_CONTENT_KIND.PENDING);
    });

    it('does not persist reuse when ownership changes after the terminal projection', async () => {
        const deps = dependencies({ follow: true });
        vi.mocked(deps.getTabWindow)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockResolvedValueOnce(null);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.activate(TAB_ID, async () => LINK_URL);

        expect(result.content).toEqual(discussionContent());
        expect(deps.getTabWindow).toHaveBeenCalledTimes(3);
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('preserves a newer association owned by the destination window', async () => {
        const ownership = deferred<number | null>();
        const deps = dependencies({ follow: true });
        vi.mocked(deps.getTabWindow)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockReturnValueOnce(ownership.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const activation = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.getTabWindow).mock.calls.length).toBe(3);
        const destinationAssociation = discussionAssociation(
            TAB_ID,
            OTHER_WINDOW_ID,
            OTHER_ITEM_ID,
        );
        deps.associations.values.set(TAB_ID, destinationAssociation);

        ownership.resolve(null);
        await activation;

        expect(deps.associations.operations).toEqual(['keep']);
        expect(deps.associations.values.get(TAB_ID)).toEqual(destinationAssociation);
    });

    it('does not publish a missing-url error after the tab leaves its window', async () => {
        const deps = dependencies({ tabWindow: null });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await expect(manager.restoreOrCheck(TAB_ID, async () => undefined))
            .rejects.toMatchObject({ name: 'AbortError' });

        expect(deps.writes.at(-1)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: TAB_ID,
        });
    });

    it('converts a thrown lookup into a recoverable error with an allow-listed warning', async () => {
        const deps = dependencies({
            follow: true,
            lookup: async () => Promise.reject(new Error(`offline ${LINK_URL}`)),
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.activate(TAB_ID, async () => LINK_URL);

        expect(result.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: TAB_ID,
            reason: HN_LOOKUP_STATUS.ERROR,
        });
        expect(deps.warn).toHaveBeenCalledExactlyOnceWith(
            FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED,
            { tabId: TAB_ID, windowId: WINDOW_ID },
        );
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('normalizes a persisted pending projection without losing its tab identity', async () => {
        const deps = dependencies({
            storedProjection: projection(7, {
                kind: SIDE_PANEL_CONTENT_KIND.PENDING,
                tabId: TAB_ID,
            }),
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await manager.normalizeStartupContent();

        expect(deps.writes).toEqual([projection(8, {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            tabId: TAB_ID,
            reason: HN_LOOKUP_STATUS.ERROR,
        })]);
    });

    it('preserves the association for the same normalized identity without lookup', async () => {
        const deps = dependencies();
        deps.associations.values.set(TAB_ID, discussionAssociation());
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await manager.navigation(
            TAB_ID,
            'https://EXAMPLE.com/story/?utm_source=test',
            false,
            false,
        );

        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.associations.values.get(TAB_ID)).toEqual(discussionAssociation());
        expect(deps.discardFrame).not.toHaveBeenCalled();
    });

    it('republishes a live active same-identity association without lookup or rewrite', async () => {
        const deps = dependencies();
        deps.associations.values.set(TAB_ID, discussionAssociation());
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.navigation(
            TAB_ID,
            'https://example.com/story/?utm_source=reload',
            true,
            true,
        );

        expect(result?.content).toEqual(discussionContent());
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.associations.operations).toEqual(['keep']);
        expect(deps.target).toHaveBeenCalledWith(TAB_ID, result?.revision);
    });

    it('invalidates a changed inactive tab without looking it up', async () => {
        const deps = dependencies({ follow: true });
        deps.associations.values.set(TAB_ID, discussionAssociation());
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await manager.navigation(TAB_ID, OTHER_LINK_URL, false, true);

        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.discardFrame).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        expect(deps.lookup).not.toHaveBeenCalled();
    });

    it('does not inspect an unchecked URL when follow is off', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await manager.navigation(TAB_ID, SECRET_SENTINEL_URL, true, true);

        expect(deps.normalizeArticleUrl).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.target).not.toHaveBeenCalled();
        expect(deps.discardFrame).not.toHaveBeenCalled();
    });

    it('checks an eligible unchecked update when follow is on and the panel is live', async () => {
        const deps = dependencies({ follow: true });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const result = await manager.navigation(TAB_ID, LINK_URL, true, true);

        expect(deps.lookup).toHaveBeenCalledExactlyOnceWith(LINK_URL, expect.any(AbortSignal));
        expect(result?.content).toEqual(discussionContent());
    });

    it('resumes one consented pending activation without re-reading follow', async () => {
        const deps = dependencies({ follow: true });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const pending = await manager.activate(TAB_ID, async () => undefined);

        const terminal = await manager.resumePendingUrl(TAB_ID, async () => LINK_URL);

        expect(pending.content).toEqual({ kind: SIDE_PANEL_CONTENT_KIND.PENDING, tabId: TAB_ID });
        expect(terminal?.content).toEqual(discussionContent());
        expect(deps.isFollowEnabled).toHaveBeenCalledOnce();
        expect(deps.lookup).toHaveBeenCalledOnce();
    });

    it('keeps a newer explicit discussion over an older automatic lookup', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies({ follow: true, lookup: async () => lookup.promise });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const automatic = manager.activate(TAB_ID, async () => LINK_URL);
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);

        const selected = await manager.showDiscussion({
            tabId: TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });
        lookup.resolve(foundPanelResult());

        await expect(automatic).rejects.toMatchObject({ name: 'AbortError' });
        expect(selected.content).toEqual(discussionContent(TAB_ID, OTHER_ITEM_ID));
        expect(deps.writes.at(-1)?.content).toEqual(selected.content);
        expect(deps.associations.values.get(TAB_ID)?.articleIdentity)
            .toBe(OTHER_ARTICLE_IDENTITY);
    });

    it('lets a selection queued before connect remain authoritative', async () => {
        const deps = dependencies();
        const associationWrite = deferred<void>();
        deps.associations.delayNextSet(associationWrite.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const selecting = manager.showDiscussion({
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        const connecting = manager.connect(TAB_ID, async () => LINK_URL);
        const ready = await connecting;
        associationWrite.resolve();
        const selected = await selecting;

        expect(ready.content).toEqual(selected.content);
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.writes.at(-1)?.content).toEqual(discussionContent());
    });

    it('consumes only the exact expected context-menu navigation and performs one lookup', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies({ lookup: async () => lookup.promise });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        const opening = manager.openLink(TAB_ID, LINK_URL);
        await manager.navigation(TAB_ID, LINK_URL, true, true);
        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(true);
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);
        lookup.resolve(foundPanelResult());
        await opening;

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(false);
        expect(deps.navigate).toHaveBeenCalledExactlyOnceWith(TAB_ID, LINK_URL);
        expect(deps.lookup).toHaveBeenCalledOnce();
    });

    it('returns explicit pending readiness when connect races a context-menu lookup', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies({ lookup: async () => lookup.promise });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const opening = manager.openLink(TAB_ID, LINK_URL);

        const ready = await manager.connect(TAB_ID, async () => LINK_URL);

        expect(ready.content).toEqual({ kind: SIDE_PANEL_CONTENT_KIND.PENDING, tabId: TAB_ID });
        await expect.poll(() => vi.mocked(deps.lookup).mock.calls.length).toBe(1);
        lookup.resolve(foundPanelResult());
        await opening;
        expect(deps.lookup).toHaveBeenCalledOnce();
    });

    it('consumes an expected navigation by normalized identity', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        manager.reserveExpectedNavigation(TAB_ID, LINK_URL);

        await manager.navigation(
            TAB_ID,
            'https://EXAMPLE.com/story/?utm_source=browser',
            true,
            true,
        );

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(false);
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.target).not.toHaveBeenCalled();
    });

    it('fails an expected navigation closed on the first unrelated URL', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        manager.reserveExpectedNavigation(TAB_ID, LINK_URL);

        await manager.navigation(TAB_ID, OTHER_LINK_URL, true, true);
        await manager.navigation(TAB_ID, LINK_URL, true, true);

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(false);
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.target).not.toHaveBeenCalled();
    });

    it('cancels the paired explicit operation after an unexpected navigation', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const expected = manager.reserveExpectedNavigation(TAB_ID, LINK_URL);
        const explicit = manager.reserveExplicitOperation(TAB_ID);
        void manager.prepareExplicitOperation(explicit);

        await manager.navigation(TAB_ID, OTHER_LINK_URL, true, true);

        expect(manager.hasExpectedNavigation(expected.tabId)).toBe(false);
        await expect(explicit.completion).resolves.toBeNull();
        expect(deps.resynchronize).toHaveBeenCalledOnce();
    });

    it('cancels a pending explicit operation after a later unrelated navigation', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        manager.reserveExpectedNavigation(TAB_ID, LINK_URL);
        const explicit = manager.reserveExplicitOperation(TAB_ID);
        await manager.prepareExplicitOperation(explicit);

        await manager.navigation(TAB_ID, LINK_URL, true, true);
        await manager.navigation(TAB_ID, OTHER_LINK_URL, true, true);

        await expect(explicit.completion).resolves.toBeNull();
        await expect(manager.showDiscussion({
            reservation: explicit,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.writes).not.toContainEqual(expect.objectContaining({
            content: discussionContent(),
        }));
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('retains an unmatched guard until a completed explicit navigation arrives', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        manager.reserveExpectedNavigation(TAB_ID, RESTRICTED_LINK_URL);
        const explicit = manager.reserveExplicitOperation(TAB_ID);
        const selected = await manager.showDiscussion({
            reservation: explicit,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: RESTRICTED_LINK_URL,
        });

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(true);
        await manager.navigation(TAB_ID, RESTRICTED_LINK_URL, true, true);

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(false);
        expect(deps.writes.at(-1)).toEqual(selected);
        expect(deps.associations.values.get(TAB_ID)?.outcome).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
        expect(deps.discardFrame).not.toHaveBeenCalled();
    });

    it('does not rebind a completed action guard to a later popup selection', async () => {
        const deps = dependencies({ follow: false });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        manager.reserveExpectedNavigation(TAB_ID, LINK_URL);
        const first = manager.reserveExplicitOperation(TAB_ID);
        await manager.showDiscussion({
            reservation: first,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        const second = manager.reserveExplicitOperation(TAB_ID);
        await manager.showDiscussion({
            reservation: second,
            tabId: TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });

        await manager.navigation(TAB_ID, LINK_URL, true, true);

        expect(deps.writes.at(-1)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.discardFrame).toHaveBeenCalledExactlyOnceWith(TAB_ID);
    });

    it('cancels context-menu reservations and resynchronizes after navigation fails', async () => {
        const deps = dependencies();
        vi.mocked(deps.navigate).mockRejectedValueOnce(new Error('tab closed'));
        const manager = new SidePanelContentManager(WINDOW_ID, deps);

        await expect(manager.openLink(TAB_ID, LINK_URL)).rejects.toThrow('tab closed');

        expect(manager.hasExpectedNavigation(TAB_ID)).toBe(false);
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.resynchronize).toHaveBeenCalledOnce();
    });

    it('settles replaced and cancelled explicit reservations without hanging', async () => {
        const manager = new SidePanelContentManager(WINDOW_ID, dependencies());
        const first = manager.reserveExplicitOperation(TAB_ID);
        const second = manager.reserveExplicitOperation(TAB_ID);
        manager.cancelExplicitOperation(second, false);

        await expect(first.readiness).resolves.toBeNull();
        await expect(first.completion).resolves.toBeNull();
        await expect(second.readiness).resolves.toBeNull();
        await expect(second.completion).resolves.toBeNull();
    });

    it('keeps the newest cross-tab explicit reservation during delayed hydration', async () => {
        const hydration = deferred<SidePanelProjection | null>();
        const deps = dependencies();
        vi.mocked(deps.readProjection).mockReturnValueOnce(hydration.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const first = manager.reserveExplicitOperation(TAB_ID);
        const firstSelection = manager.showDiscussion({
            reservation: first,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        const second = manager.reserveExplicitOperation(OTHER_TAB_ID);
        const secondSelection = manager.showDiscussion({
            reservation: second,
            tabId: OTHER_TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });

        hydration.resolve(null);

        await expect(firstSelection).rejects.toMatchObject({ name: 'AbortError' });
        await expect(first.completion).resolves.toBeNull();
        await expect(secondSelection).resolves.toEqual(expect.objectContaining({
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        }));
        await expect(second.completion).resolves.toEqual(expect.objectContaining({
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        }));
        expect(deps.writes.at(-1)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
        expect(deps.associations.values.get(OTHER_TAB_ID)?.outcome).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });

    it('does not let stale explicit recovery supersede the newest cross-tab selection', async () => {
        const hydration = deferred<SidePanelProjection | null>();
        const newestOwnership = deferred<number | null>();
        const resumeRecovery = deferred<void>();
        const deps = dependencies();
        vi.mocked(deps.readProjection).mockReturnValueOnce(hydration.promise);
        vi.mocked(deps.getTabWindow)
            .mockReturnValueOnce(newestOwnership.promise)
            .mockResolvedValue(WINDOW_ID);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        vi.mocked(deps.resynchronize).mockImplementation(async () => {
            await resumeRecovery.promise;
            await manager.activate(THIRD_TAB_ID, async () => THIRD_LINK_URL);
        });
        const first = manager.reserveExplicitOperation(TAB_ID);
        const firstFailure = manager.showDiscussion({
            reservation: first,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        }).catch((error: unknown) => error);
        const second = manager.reserveExplicitOperation(OTHER_TAB_ID);
        const secondSelection = manager.showDiscussion({
            reservation: second,
            tabId: OTHER_TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });

        hydration.resolve(null);
        await expect.poll(() => vi.mocked(deps.getTabWindow).mock.calls.length).toBe(1);
        resumeRecovery.resolve();
        newestOwnership.resolve(WINDOW_ID);

        await expect(firstFailure).resolves.toMatchObject({ name: 'AbortError' });
        await expect(secondSelection).resolves.toEqual(expect.objectContaining({
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        }));
        expect(deps.resynchronize).not.toHaveBeenCalled();
        expect(deps.writes.at(-1)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
    });

    it('rechecks ownership after a terminal projection waits in the write queue', async () => {
        const blockedWrite = deferred<void>();
        let ownedWindowId = WINDOW_ID;
        const deps = dependencies({ follow: true });
        vi.mocked(deps.getTabWindow).mockImplementation(async () => ownedWindowId);
        vi.mocked(deps.writeProjection).mockImplementationOnce(async (nextProjection) => {
            deps.writes.push(nextProjection);
            await blockedWrite.promise;
            deps.storedProjection = nextProjection;
        });
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const automatic = manager.activate(OTHER_TAB_ID, async () => OTHER_LINK_URL);
        await expect.poll(() => deps.writes.length).toBe(1);
        const explicit = manager.reserveExplicitOperation(TAB_ID);
        const selection = manager.showDiscussion({
            reservation: explicit,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        await expect.poll(() => vi.mocked(deps.getTabWindow).mock.calls.length).toBe(1);

        ownedWindowId = OTHER_WINDOW_ID;
        blockedWrite.resolve();

        await expect(selection).rejects.toMatchObject({ name: 'AbortError' });
        await expect(automatic).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.writes).not.toContainEqual(expect.objectContaining({
            content: discussionContent(),
        }));
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('rejects explicit content when the tab moved out of the request window', async () => {
        const ownership = deferred<number | null>();
        const deps = dependencies();
        vi.mocked(deps.getTabWindow).mockReturnValueOnce(ownership.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const selection = manager.showDiscussion({
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        ownership.resolve(OTHER_WINDOW_ID);

        await expect(selection).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.writes).not.toContainEqual(expect.objectContaining({
            content: discussionContent(),
        }));
        expect(deps.associations.values.has(TAB_ID)).toBe(false);
    });

    it('serializes an older navigation removal before a newer explicit set', async () => {
        const firstMutation = deferred<void>();
        const deps = dependencies();
        deps.associations.values.set(TAB_ID, discussionAssociation());
        deps.associations.delayNextSet(firstMutation.promise);
        const manager = new SidePanelContentManager(WINDOW_ID, deps);
        const navigation = manager.navigation(TAB_ID, OTHER_LINK_URL, false, true);
        const explicit = manager.showDiscussion({
            tabId: TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });
        firstMutation.resolve();
        await Promise.all([navigation, explicit]);

        expect(deps.associations.values.get(TAB_ID)?.outcome).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });
});

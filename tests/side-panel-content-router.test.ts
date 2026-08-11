import { describe, expect, it, vi } from 'vitest';

import type { PanelLookupResult } from '../src/background/article-lookup';
import {
    SidePanelLifecycleController,
} from '../src/background/side-panel-content-controller';
import type { SidePanelAssociationMutation } from '../src/browser/side-panel-association-store';
import { SidePanelContentRouter } from '../src/browser/side-panel-content-router';
import type {
    SidePanelContentRouterDependencies,
    SidePanelWindowProjection,
} from '../src/browser/side-panel-content-router';
import { HN_LOOKUP_STATUS } from '../src/domain/hn';
import { normalizeArticleUrl } from '../src/domain/url';
import {
    SIDE_PANEL_ASSOCIATION_ORIGIN,
} from '../src/shared/side-panel-association';
import type { SidePanelAssociation } from '../src/shared/side-panel-association';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelContent } from '../src/shared/side-panel-content';
import type { SidePanelProjection } from '../src/shared/side-panel-projection';

const ITEM_ID = '424242';
const OTHER_ITEM_ID = '515151';
const LINK_URL = 'https://example.com/story';
const OTHER_LINK_URL = 'https://example.com/other';
const TAB_ID = 7;
const OTHER_TAB_ID = 8;
const WINDOW_ID = 1;
const OTHER_WINDOW_ID = 2;

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve(value: Value): void;
}

interface RouterHarness extends SidePanelContentRouterDependencies {
    associationValues: Map<number, SidePanelAssociation>;
    projections: Map<number, SidePanelProjection>;
    writes: SidePanelWindowProjection[];
}

/**
 * Creates a manually settled promise for lifecycle races.
 */
function deferred<Value>(): Deferred<Value> {
    let resolve: (value: Value) => void = () => undefined;
    const promise = new Promise<Value>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

/**
 * Builds one found lookup result for a URL.
 */
function foundPanelResult(url: string): PanelLookupResult {
    const other = url === OTHER_LINK_URL;
    return {
        result: {
            status: HN_LOOKUP_STATUS.FOUND,
            primary: {
                id: other ? OTHER_ITEM_ID : ITEM_ID,
                title: 'Discussion',
                articleUrl: url,
                comments: 10,
                points: 20,
                createdAt: 1,
            },
            alternatives: [],
        },
        articleIdentity: other ? 'example.com/other' : 'example.com/story',
    };
}

/**
 * Builds strict tab-aware panel content.
 */
function discussionContent(tabId: number, itemId: string): SidePanelContent {
    return { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId, itemId };
}

/**
 * Builds router dependencies backed by in-memory projection and association stores.
 */
function dependencies(initial: SidePanelWindowProjection[] = []): RouterHarness {
    const projections = new Map(initial.map(({ windowId, projection }) => [windowId, projection]));
    const writes: SidePanelWindowProjection[] = [];
    const associations = new Map<number, SidePanelAssociation>();
    return {
        associationValues: associations,
        projections,
        writes,
        associations: {
            settledGet: vi.fn(async (tabId: number) => associations.get(tabId) ?? null),
            mutate: vi.fn(async (
                tabId: number,
                operation: (
                    current: SidePanelAssociation | null,
                ) => Promise<SidePanelAssociationMutation> | SidePanelAssociationMutation,
            ) => {
                const decision = await operation(associations.get(tabId) ?? null);
                if (decision.kind === 'remove') {
                    associations.delete(tabId);
                    return null;
                }
                if (decision.kind === 'set') {
                    associations.set(tabId, decision.association);
                    return decision.association;
                }
                return associations.get(tabId) ?? null;
            }),
        },
        readProjection: vi.fn(async (windowId: number) => projections.get(windowId) ?? null),
        writeProjection: vi.fn(async (windowId: number, projection: SidePanelProjection) => {
            projections.set(windowId, projection);
            writes.push({ windowId, projection });
        }),
        removeProjection: vi.fn(async (windowId: number) => {
            projections.delete(windowId);
        }),
        listProjections: vi.fn(async () => [...projections.entries()]
            .map(([windowId, projection]) => ({ windowId, projection }))),
        isFollowEnabled: vi.fn(async () => true),
        lookup: vi.fn(async (url: string) => foundPanelResult(url)),
        getTabWindow: vi.fn(async (tabId: number) => tabId === OTHER_TAB_ID
            ? OTHER_WINDOW_ID
            : WINDOW_ID),
        normalizeArticleUrl: vi.fn(normalizeArticleUrl),
        openSidePanel: vi.fn(async () => undefined),
        navigate: vi.fn(async () => undefined),
        resynchronize: vi.fn(async () => undefined),
        discardFrame: vi.fn(),
        target: vi.fn(),
        warn: vi.fn(),
    };
}

describe('SidePanelContentRouter', () => {
    it('routes automatic synchronization to the manager for its own window', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        const first = await router.activate(WINDOW_ID, TAB_ID, async () => LINK_URL);
        const second = await router.activate(
            OTHER_WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );

        expect(first.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(second.content).toEqual(discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID));
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual(first.content);
        expect(deps.projections.get(OTHER_WINDOW_ID)?.content).toEqual(second.content);
        expect(deps.target).toHaveBeenCalledWith(WINDOW_ID, TAB_ID, 1);
        expect(deps.target).toHaveBeenCalledWith(OTHER_WINDOW_ID, OTHER_TAB_ID, 1);
    });

    it('does not let delayed explicit recovery supersede a newer reservation', async () => {
        const activeTab = deferred<chrome.tabs.Tab | null>();
        const newestOwnership = deferred<number | null>();
        const deps = dependencies();
        vi.mocked(deps.getTabWindow)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockResolvedValueOnce(WINDOW_ID)
            .mockReturnValueOnce(newestOwnership.promise)
            .mockResolvedValue(WINDOW_ID);
        vi.mocked(deps.writeProjection).mockRejectedValueOnce(new Error('projection unavailable'));
        const router = new SidePanelContentRouter(deps);
        const recover = vi.spyOn(router, 'recover');
        const getTab = vi.fn(async (tabId: number) => ({
            id: tabId,
            windowId: WINDOW_ID,
            active: true,
            index: 0,
            url: LINK_URL,
        }) as chrome.tabs.Tab);
        const lifecycle = new SidePanelLifecycleController({
            windows: { has: vi.fn(() => true) },
            content: router,
            getActiveTab: vi.fn(async () => activeTab.promise),
            getTab,
        });
        vi.mocked(deps.resynchronize).mockImplementation(async (reservation) => {
            await lifecycle.resynchronizeWindow(reservation);
        });
        const firstSelection = router.showDiscussion(WINDOW_ID, {
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });

        await expect(firstSelection).rejects.toThrow('projection unavailable');
        await expect.poll(() => vi.mocked(deps.resynchronize).mock.calls.length).toBe(1);
        const second = router.reserveExplicitOperation(WINDOW_ID, OTHER_TAB_ID);
        const secondSelection = router.showDiscussion(WINDOW_ID, {
            reservation: second,
            tabId: OTHER_TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });
        await expect.poll(() => vi.mocked(deps.getTabWindow).mock.calls.length).toBe(2);

        activeTab.resolve({
            id: TAB_ID,
            windowId: WINDOW_ID,
            active: true,
            index: 0,
            url: LINK_URL,
        } as chrome.tabs.Tab);
        const recovery = vi.mocked(deps.resynchronize).mock.results[0]?.value;
        await recovery;
        newestOwnership.resolve(WINDOW_ID);

        expect(recover).toHaveBeenCalledOnce();
        expect(vi.mocked(deps.resynchronize).mock.calls[0]?.[0].signal.aborted).toBe(true);
        expect(getTab).not.toHaveBeenCalled();
        await expect(secondSelection).resolves.toEqual(expect.objectContaining({
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        }));
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
    });

    it('settles concurrent lookups without crossing window projections', async () => {
        const firstLookup = deferred<PanelLookupResult>();
        const secondLookup = deferred<PanelLookupResult>();
        const deps = dependencies();
        vi.mocked(deps.lookup).mockImplementation(async (url) => (
            url === LINK_URL ? firstLookup.promise : secondLookup.promise
        ));
        const router = new SidePanelContentRouter(deps);

        const first = router.activate(WINDOW_ID, TAB_ID, async () => LINK_URL);
        await vi.waitFor(() => {
            expect(deps.lookup).toHaveBeenCalledTimes(1);
        }, { interval: 1 });
        const second = router.activate(
            OTHER_WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );
        await vi.waitFor(() => {
            expect(deps.lookup).toHaveBeenCalledTimes(2);
        }, { interval: 1 });

        expect(deps.projections.get(WINDOW_ID)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: TAB_ID,
        });
        secondLookup.resolve(foundPanelResult(OTHER_LINK_URL));
        await second;

        expect(deps.projections.get(WINDOW_ID)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.PENDING,
            tabId: TAB_ID,
        });
        expect(deps.projections.get(OTHER_WINDOW_ID)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );

        firstLookup.resolve(foundPanelResult(LINK_URL));
        await first;

        expect(deps.projections.get(WINDOW_ID)?.content).toEqual(
            discussionContent(TAB_ID, ITEM_ID),
        );
        expect(deps.projections.get(OTHER_WINDOW_ID)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
    });

    it('restores reusable content without acquiring a URL or looking it up', async () => {
        const deps = dependencies();
        deps.associationValues.set(TAB_ID, {
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            origin: SIDE_PANEL_ASSOCIATION_ORIGIN.MANUAL,
            outcome: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
            articleIdentity: 'example.com/story',
        });
        vi.mocked(deps.isFollowEnabled).mockResolvedValue(false);
        const router = new SidePanelContentRouter(deps);
        const readUrl = vi.fn(async () => LINK_URL);

        const result = await router.activate(WINDOW_ID, TAB_ID, readUrl);

        expect(result.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.isFollowEnabled).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.discardFrame).not.toHaveBeenCalled();
        expect(deps.target).toHaveBeenCalledExactlyOnceWith(WINDOW_ID, TAB_ID, 1);
    });

    it('returns the exact projection applied by connect without re-reading storage', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        const result = await router.connect(WINDOW_ID, TAB_ID, async () => LINK_URL);

        expect(result).toBe(deps.writes.at(-1)?.projection);
        expect(deps.readProjection).toHaveBeenCalledOnce();
        expect(result).toEqual({
            revision: 2,
            content: discussionContent(TAB_ID, ITEM_ID),
        });
    });

    it('routes a one-shot manual check without consulting the follow preference', async () => {
        const deps = dependencies();
        vi.mocked(deps.isFollowEnabled).mockResolvedValue(false);
        const router = new SidePanelContentRouter(deps);

        const result = await router.restoreOrCheck(WINDOW_ID, TAB_ID, async () => LINK_URL);

        expect(result.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(deps.isFollowEnabled).not.toHaveBeenCalled();
    });

    it('reserves follow activation without reading storage, targeting, or acquiring a URL', () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);

        expect(reservation).toEqual({ windowId: WINDOW_ID, tabId: TAB_ID, token: 1 });
        expect(deps.readProjection).not.toHaveBeenCalled();
        expect(deps.isFollowEnabled).not.toHaveBeenCalled();
        expect(deps.target).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.writes).toEqual([]);
    });

    it('continues only the exact captured follow activation through the router', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const readUrl = vi.fn(async () => LINK_URL);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);

        const result = await router.continueFollowActivation(reservation, readUrl);

        expect(result?.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(readUrl).toHaveBeenCalledOnce();
        await expect(router.continueFollowActivation(reservation, readUrl)).resolves.toBeNull();
        expect(readUrl).toHaveBeenCalledOnce();
    });

    it('keeps a later one-click capture across earlier queued setting effects', async () => {
        const deps = dependencies();
        vi.mocked(deps.getTabWindow).mockResolvedValue(WINDOW_ID);
        const router = new SidePanelContentRouter(deps);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);
        await router.synchronizeFollowSetting(
            WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );
        await router.disableAutomatic();

        const continued = await router.continueFollowActivation(
            reservation,
            async () => LINK_URL,
        );

        expect(continued?.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(deps.projections.get(WINDOW_ID)).toEqual(continued);
    });

    it('does not let a later explicit selection inherit a captured follow activation', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const readUrl = vi.fn(async () => LINK_URL);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);

        const explicit = await router.showDiscussion(WINDOW_ID, {
            tabId: TAB_ID,
            itemId: OTHER_ITEM_ID,
            sourceUrl: OTHER_LINK_URL,
        });
        const continued = await router.continueFollowActivation(reservation, readUrl);

        expect(continued).toBeNull();
        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.projections.get(WINDOW_ID)).toEqual(explicit);
    });

    it('does not let an ordinary setting enable supersede an explicit operation', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const explicit = router.reserveExplicitOperation(WINDOW_ID, TAB_ID);
        const pending = await router.prepareExplicitOperation(WINDOW_ID, explicit);
        const readUrl = vi.fn(async () => OTHER_LINK_URL);

        const synchronized = await router.synchronizeFollowSetting(
            WINDOW_ID,
            OTHER_TAB_ID,
            readUrl,
        );
        const selected = await router.showDiscussion(WINDOW_ID, {
            reservation: explicit,
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });

        expect(synchronized).toEqual(pending);
        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.projections.get(WINDOW_ID)).toEqual(selected);
    });

    it('rejects an old setting snapshot after a newer real activation', async () => {
        const deps = dependencies();
        vi.mocked(deps.getTabWindow).mockResolvedValue(WINDOW_ID);
        const router = new SidePanelContentRouter(deps);
        const authority = router.captureFollowAuthority(WINDOW_ID);
        const activated = await router.activate(
            WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );
        const readOldUrl = vi.fn(async () => LINK_URL);

        const result = await router.synchronizeFollowSettingWithStatus(
            authority,
            TAB_ID,
            readOldUrl,
        );

        expect(result).toEqual({ kind: 'active_tab_changed' });
        expect(readOldUrl).not.toHaveBeenCalled();
        expect(deps.projections.get(WINDOW_ID)).toEqual(activated);
    });

    it('preserves a newer completed explicit selection across an old setting snapshot', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const authority = router.captureFollowAuthority(WINDOW_ID);
        const selected = await router.showDiscussion(WINDOW_ID, {
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });
        const readUrl = vi.fn(async () => OTHER_LINK_URL);

        const result = await router.synchronizeFollowSettingWithStatus(
            authority,
            OTHER_TAB_ID,
            readUrl,
        );

        expect(result).toEqual({ kind: 'superseded', projection: selected });
        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.projections.get(WINDOW_ID)).toEqual(selected);
    });

    it('waits for a newer manual Check instead of rolling queued Follow back', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies();
        vi.mocked(deps.lookup).mockReturnValueOnce(lookup.promise);
        const router = new SidePanelContentRouter(deps);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);
        const manual = router.restoreOrCheck(WINDOW_ID, TAB_ID, async () => LINK_URL);
        await vi.waitFor(() => {
            expect(deps.lookup).toHaveBeenCalledOnce();
        });

        const continuing = router.continueFollowActivationWithStatus(
            reservation,
            async () => OTHER_LINK_URL,
        );
        lookup.resolve(foundPanelResult(LINK_URL));
        const checked = await manual;

        await expect(continuing).resolves.toEqual({
            kind: 'superseded',
            projection: checked,
        });
        expect(deps.projections.get(WINDOW_ID)).toEqual(checked);
    });

    it('lets a real later activation supersede a queued follow capture', async () => {
        const deps = dependencies();
        vi.mocked(deps.getTabWindow).mockResolvedValue(WINDOW_ID);
        const router = new SidePanelContentRouter(deps);
        const readCapturedUrl = vi.fn(async () => LINK_URL);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);

        const activated = await router.activate(
            WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );
        const continued = await router.continueFollowActivation(
            reservation,
            readCapturedUrl,
        );

        expect(continued).toBeNull();
        expect(readCapturedUrl).not.toHaveBeenCalled();
        expect(deps.projections.get(WINDOW_ID)).toEqual(activated);
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
    });

    it('reports a later activation instead of leaking its AbortError from continuation', async () => {
        const firstLookup = deferred<PanelLookupResult>();
        const deps = dependencies();
        vi.mocked(deps.getTabWindow).mockResolvedValue(WINDOW_ID);
        vi.mocked(deps.lookup)
            .mockReturnValueOnce(firstLookup.promise)
            .mockResolvedValueOnce(foundPanelResult(OTHER_LINK_URL));
        const router = new SidePanelContentRouter(deps);
        const reservation = router.reserveFollowActivation(WINDOW_ID, TAB_ID);
        const continuing = router.continueFollowActivation(
            reservation,
            async () => LINK_URL,
        );
        await vi.waitFor(() => {
            expect(deps.lookup).toHaveBeenCalledOnce();
        });

        const activated = router.activate(
            WINDOW_ID,
            OTHER_TAB_ID,
            async () => OTHER_LINK_URL,
        );
        firstLookup.resolve(foundPanelResult(LINK_URL));

        await expect(continuing).resolves.toBeNull();
        await expect(activated).resolves.toMatchObject({
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        });
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual(
            discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        );
    });

    it('normalizes only persisted pending projections and preserves their tab', async () => {
        const pending: SidePanelProjection = {
            revision: 3,
            content: { kind: SIDE_PANEL_CONTENT_KIND.PENDING, tabId: TAB_ID },
        };
        const shown: SidePanelProjection = {
            revision: 5,
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        };
        const deps = dependencies([
            { windowId: WINDOW_ID, projection: pending },
            { windowId: OTHER_WINDOW_ID, projection: shown },
        ]);
        const router = new SidePanelContentRouter(deps);

        await router.normalizeStartupContent();

        expect(deps.projections.get(WINDOW_ID)).toEqual({
            revision: 4,
            content: {
                kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
                tabId: TAB_ID,
                reason: HN_LOOKUP_STATUS.ERROR,
            },
        });
        expect(deps.projections.get(OTHER_WINDOW_ID)).toEqual(shown);
    });

    it('forgets one window without touching another window projection', async () => {
        const first: SidePanelProjection = {
            revision: 1,
            content: discussionContent(TAB_ID, ITEM_ID),
        };
        const second: SidePanelProjection = {
            revision: 1,
            content: discussionContent(OTHER_TAB_ID, OTHER_ITEM_ID),
        };
        const deps = dependencies([
            { windowId: WINDOW_ID, projection: first },
            { windowId: OTHER_WINDOW_ID, projection: second },
        ]);
        const router = new SidePanelContentRouter(deps);

        await router.forgetWindow(WINDOW_ID);

        expect(deps.projections.has(WINDOW_ID)).toBe(false);
        expect(deps.projections.get(OTHER_WINDOW_ID)).toEqual(second);
        expect(deps.removeProjection).toHaveBeenCalledExactlyOnceWith(WINDOW_ID);
    });

    it('routes an explicit selection and its source URL to the owning window manager', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        const result = await router.showDiscussion(WINDOW_ID, {
            tabId: TAB_ID,
            itemId: ITEM_ID,
            sourceUrl: LINK_URL,
        });

        expect(result.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(deps.projections.get(WINDOW_ID)).toEqual(result);
    });

    it('routes navigation only through the tab window manager', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        const result = await router.navigation(WINDOW_ID, TAB_ID, LINK_URL, true, true);

        expect(result?.content).toEqual(discussionContent(TAB_ID, ITEM_ID));
        expect(deps.projections.has(OTHER_WINDOW_ID)).toBe(false);
    });

    it('cancels an unfinished lookup and replaces pending on the last disconnect', async () => {
        const lookup = deferred<PanelLookupResult>();
        const deps = dependencies();
        vi.mocked(deps.lookup).mockReturnValueOnce(lookup.promise);
        const router = new SidePanelContentRouter(deps);
        const activation = router.activate(WINDOW_ID, TAB_ID, async () => LINK_URL);
        await vi.waitFor(() => {
            expect(deps.projections.get(WINDOW_ID)?.content).toEqual({
                kind: SIDE_PANEL_CONTENT_KIND.PENDING,
                tabId: TAB_ID,
            });
        });

        await router.disconnectWindow(WINDOW_ID);
        lookup.resolve(foundPanelResult(LINK_URL));

        await expect(activation).rejects.toMatchObject({ name: 'AbortError' });
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
    });

    it('preserves a completed terminal projection on the last disconnect', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const completed = await router.activate(WINDOW_ID, TAB_ID, async () => LINK_URL);
        const writesBeforeDisconnect = deps.writes.length;

        await router.disconnectWindow(WINDOW_ID);

        expect(deps.projections.get(WINDOW_ID)).toEqual(completed);
        expect(deps.writes).toHaveLength(writesBeforeDisconnect);
    });

    it('settles an unfinished explicit operation on the last disconnect', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);
        const explicit = router.reserveExplicitOperation(WINDOW_ID, TAB_ID);
        const pending = await router.prepareExplicitOperation(WINDOW_ID, explicit);

        await router.disconnectWindow(WINDOW_ID);

        await expect(explicit.readiness).resolves.toEqual(pending);
        await expect(explicit.completion).resolves.toBeNull();
        expect(deps.projections.get(WINDOW_ID)?.content).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED,
            tabId: TAB_ID,
        });
    });
});

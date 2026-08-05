import { describe, expect, it, vi } from 'vitest';

import { SidePanelContentRouter } from '../src/browser/side-panel-content-router';
import type {
    SidePanelContentRouterDependencies,
    SidePanelWindowContent,
} from '../src/browser/side-panel-content-router';
import { HN_LOOKUP_STATUS } from '../src/domain/hn';
import type { HnLookupResult } from '../src/domain/hn';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelContent } from '../src/shared/side-panel-content';

const ITEM_ID = '424242';
const OTHER_ITEM_ID = '515151';
const LINK_URL = 'https://example.com/story';
const TAB_ID = 7;
const WINDOW_ID = 1;
const OTHER_WINDOW_ID = 2;

const PENDING: SidePanelContent = { kind: SIDE_PANEL_CONTENT_KIND.PENDING };

const foundResult: HnLookupResult = {
    status: HN_LOOKUP_STATUS.FOUND,
    primary: {
        id: ITEM_ID,
        title: 'Primary discussion',
        articleUrl: LINK_URL,
        comments: 10,
        points: 20,
        createdAt: 1,
    },
    alternatives: [],
};

/**
 * Builds dependencies backed by an in-memory per-window store.
 * @param initial - The selections the session starts with.
 */
function dependencies(initial: SidePanelWindowContent[] = []): SidePanelContentRouterDependencies & {
    store: Map<number, SidePanelContent>;
    writes: SidePanelWindowContent[];
} {
    const store = new Map<number, SidePanelContent>(
        initial.map(({ windowId, content }) => [windowId, content]),
    );
    const writes: SidePanelWindowContent[] = [];
    return {
        store,
        writes,
        openSidePanel: vi.fn(async () => undefined),
        navigate: vi.fn(async () => undefined),
        readContent: vi.fn(async (windowId: number) => store.get(windowId) ?? null),
        writeContent: vi.fn(async (windowId: number, content: SidePanelContent) => {
            store.set(windowId, content);
            writes.push({ windowId, content });
        }),
        removeContent: vi.fn(async (windowId: number) => {
            store.delete(windowId);
        }),
        listContent: vi.fn(async () => [...store.entries()]
            .map(([windowId, content]) => ({ windowId, content }))),
        lookup: vi.fn(async () => foundResult),
        warn: vi.fn(),
    };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SidePanelContentRouter', () => {
    it('routes each selection to the window it was made in', async () => {
        const deps = dependencies();
        const router = new SidePanelContentRouter(deps);

        await router.showDiscussion(ITEM_ID, WINDOW_ID);
        await router.showDiscussion(OTHER_ITEM_ID, OTHER_WINDOW_ID);

        expect(deps.store.get(WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
        expect(deps.store.get(OTHER_WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });

    it('never lets one window\'s click supersede another window\'s lookup', async () => {
        const deps = dependencies();
        let signal: AbortSignal | undefined;
        vi.mocked(deps.lookup).mockImplementationOnce(async (_url, lookupSignal) => {
            signal = lookupSignal;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return foundResult;
        });
        const router = new SidePanelContentRouter(deps);

        router.openLink(LINK_URL, TAB_ID, WINDOW_ID);
        await router.showDiscussion(OTHER_ITEM_ID, OTHER_WINDOW_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(signal?.aborted).toBe(false);
        expect(deps.store.get(WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
        expect(deps.store.get(OTHER_WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });

    it('reuses one owner per window so a newer click in it still wins', async () => {
        const deps = dependencies();
        let signal: AbortSignal | undefined;
        vi.mocked(deps.lookup).mockImplementationOnce(async (_url, lookupSignal) => {
            signal = lookupSignal;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return foundResult;
        });
        const router = new SidePanelContentRouter(deps);

        router.openLink(LINK_URL, TAB_ID, WINDOW_ID);
        await router.showDiscussion(OTHER_ITEM_ID, WINDOW_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(signal?.aborted).toBe(true);
        expect(deps.store.get(WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });

    it('normalizes stale pending states in every window and only those', async () => {
        const shown: SidePanelContent = { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID };
        const deps = dependencies([
            { windowId: WINDOW_ID, content: PENDING },
            { windowId: OTHER_WINDOW_ID, content: shown },
        ]);
        const router = new SidePanelContentRouter(deps);

        await router.normalizeStartupContent();

        expect(deps.store.get(WINDOW_ID)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            reason: HN_LOOKUP_STATUS.ERROR,
        });
        expect(deps.store.get(OTHER_WINDOW_ID)).toEqual(shown);
        expect(deps.writes).toEqual([{
            windowId: WINDOW_ID,
            content: { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.ERROR },
        }]);
    });

    it('forgets a closed window and blocks its late lookup from returning', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return foundResult;
        });
        const router = new SidePanelContentRouter(deps);

        router.openLink(LINK_URL, TAB_ID, WINDOW_ID);
        await settle();
        await router.forgetWindow(WINDOW_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(deps.store.has(WINDOW_ID)).toBe(false);
        expect(deps.writes).toEqual([{ windowId: WINDOW_ID, content: PENDING }]);
    });
});

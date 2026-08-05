import { describe, expect, it, vi } from 'vitest';

import { SidePanelContentManager } from '../src/browser/side-panel-content-manager';
import type { SidePanelContentDependencies } from '../src/browser/side-panel-content-manager';
import { HN_LOOKUP_ERROR_REASON, HN_LOOKUP_STATUS } from '../src/domain/hn';
import type { HnLookupResult } from '../src/domain/hn';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import type { SidePanelContent } from '../src/shared/side-panel-content';

const ITEM_ID = '424242';
const OTHER_ITEM_ID = '515151';
const LINK_URL = 'https://example.com/story';
const OTHER_LINK_URL = 'https://example.com/other';
const TAB_ID = 7;

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
 * Builds dependencies that record every write and resolve lookups on demand.
 * @param stored - The content the panel starts with.
 */
function dependencies(stored: SidePanelContent | null = null): SidePanelContentDependencies & {
    writes: SidePanelContent[];
} {
    const writes: SidePanelContent[] = [];
    return {
        writes,
        openSidePanel: vi.fn(async () => undefined),
        navigate: vi.fn(async () => undefined),
        readContent: vi.fn(async () => stored),
        writeContent: vi.fn(async (content: SidePanelContent) => {
            writes.push(content);
        }),
        lookup: vi.fn(async () => foundResult),
        warn: vi.fn(),
    };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SidePanelContentManager.openLink', () => {
    it('opens the panel synchronously, loads the link, then shows the discussion', async () => {
        const deps = dependencies();
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);

        // The context-menu gesture survives only a synchronous call.
        expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        await settle();
        expect(deps.navigate).toHaveBeenCalledExactlyOnceWith(TAB_ID, LINK_URL);
        expect(deps.writes).toEqual([
            PENDING,
            { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID },
        ]);
        expect(deps.warn).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'no discussion exists', result: { status: HN_LOOKUP_STATUS.NOT_FOUND }, reason: HN_LOOKUP_STATUS.NOT_FOUND },
        { name: 'the link is not eligible', result: { status: HN_LOOKUP_STATUS.RESTRICTED }, reason: HN_LOOKUP_STATUS.RESTRICTED },
        {
            name: 'the lookup fails',
            result: { status: HN_LOOKUP_STATUS.ERROR, reason: HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED },
            reason: HN_LOOKUP_STATUS.ERROR,
        },
    ])('reports the panel state when $name', async ({ result, reason }) => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockResolvedValueOnce(result);
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await settle();

        expect(deps.writes).toEqual([PENDING, { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason }]);
    });

    it('reports a failure state when the lookup throws', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockRejectedValueOnce(new Error('offline'));
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await settle();

        expect(deps.writes).toEqual([
            PENDING,
            { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.ERROR },
        ]);
        expect(deps.warn).toHaveBeenCalledOnce();
    });

    it('never navigates to a link whose scheme is not http or https', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockResolvedValueOnce({ status: HN_LOOKUP_STATUS.RESTRICTED });
        const manager = new SidePanelContentManager(deps);

        manager.openLink('javascript:alert(1)', TAB_ID);
        await settle();

        expect(deps.navigate).not.toHaveBeenCalled();
        expect(deps.writes.at(-1)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            reason: HN_LOOKUP_STATUS.RESTRICTED,
        });
    });

    it('still resolves the discussion when the panel refuses to open', async () => {
        const deps = dependencies();
        vi.mocked(deps.openSidePanel).mockRejectedValueOnce(new Error('gesture consumed'));
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await settle();

        expect(deps.writes.at(-1)).toEqual({ kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID });
        expect(deps.warn).toHaveBeenCalledOnce();
    });

    it('still resolves the discussion when the tab is gone', async () => {
        const deps = dependencies();
        vi.mocked(deps.navigate).mockRejectedValueOnce(new Error('no tab with id 7'));
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await settle();

        expect(deps.writes.at(-1)).toEqual({ kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID });
        expect(deps.warn).toHaveBeenCalledOnce();
    });

    it('drops the result of a selection the user has already replaced', async () => {
        const deps = dependencies();
        let firstSignal: AbortSignal | undefined;
        vi.mocked(deps.lookup)
            .mockImplementationOnce(async (_url, signal) => {
                firstSignal = signal;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return foundResult;
            })
            .mockResolvedValueOnce({
                ...foundResult,
                primary: { ...foundResult.primary, id: OTHER_ITEM_ID },
            });
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        manager.openLink(OTHER_LINK_URL, TAB_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(firstSignal?.aborted).toBe(true);
        expect(deps.writes.at(-1)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
        expect(deps.writes).not.toContainEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
    });
});

describe('SidePanelContentManager.showDiscussion', () => {
    it('supersedes a lookup that is still running', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return foundResult;
        });
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await manager.showDiscussion(OTHER_ITEM_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(deps.writes.at(-1)).toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: OTHER_ITEM_ID,
        });
    });

    it('returns the content it recorded', async () => {
        const deps = dependencies();
        const manager = new SidePanelContentManager(deps);

        await expect(manager.showDiscussion(ITEM_ID)).resolves.toEqual({
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            itemId: ITEM_ID,
        });
    });
});

describe('SidePanelContentManager.discard', () => {
    it('keeps a discarded lookup from writing its result back', async () => {
        const deps = dependencies();
        let signal: AbortSignal | undefined;
        vi.mocked(deps.lookup).mockImplementationOnce(async (_url, lookupSignal) => {
            signal = lookupSignal;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return foundResult;
        });
        const manager = new SidePanelContentManager(deps);

        manager.openLink(LINK_URL, TAB_ID);
        await settle();
        manager.discard();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(signal?.aborted).toBe(true);
        expect(deps.writes).toEqual([PENDING]);
    });
});

describe('SidePanelContentManager.normalizeStartupContent', () => {
    it('resolves a pending state left behind by a stopped worker', async () => {
        const deps = dependencies(PENDING);
        const manager = new SidePanelContentManager(deps);

        await manager.normalizeStartupContent();

        expect(deps.writes).toEqual([{
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            reason: HN_LOOKUP_STATUS.ERROR,
        }]);
    });

    it.each([
        { name: 'nothing is selected', stored: null },
        { name: 'a discussion is selected', stored: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID } },
        {
            name: 'a finished lookup is shown',
            stored: { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.NOT_FOUND },
        },
    ])('leaves the panel alone when $name', async ({ stored }) => {
        const deps = dependencies(stored);
        const manager = new SidePanelContentManager(deps);

        await manager.normalizeStartupContent();

        expect(deps.writeContent).not.toHaveBeenCalled();
    });

    it('yields to a selection that arrived while it was reading', async () => {
        const deps = dependencies(PENDING);
        vi.mocked(deps.readContent).mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return PENDING;
        });
        const manager = new SidePanelContentManager(deps);

        const normalizing = manager.normalizeStartupContent();
        await manager.showDiscussion(ITEM_ID);
        await normalizing;

        expect(deps.writes).toEqual([{ kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: ITEM_ID }]);
    });
});

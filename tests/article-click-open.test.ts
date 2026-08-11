import { describe, expect, it, vi } from 'vitest';

import { respondToArticleClick } from '../src/browser/article-click-open';
import type { ArticleClickOpenDependencies } from '../src/browser/article-click-open';
import type {
    ExpectedNavigationReservation,
    ExplicitOperationReservation,
} from '../src/browser/side-panel-content-manager';
import { SIDE_PANEL_CONTENT_KIND } from '../src/shared/side-panel-content';
import { FOLLOW_DIAGNOSTIC_CODE } from '../src/shared/logger';

const HN_ORIGIN = 'https://news.ycombinator.com';
const ITEM_ID = '424242';
const ARTICLE_URL = 'https://example.com/story';
const TAB_ID = 7;
const WINDOW_ID = 3;

function dependencies(cached: boolean | undefined, stored = true): ArticleClickOpenDependencies {
    const expected: ExpectedNavigationReservation = { tabId: TAB_ID, token: 1 };
    const explicit: ExplicitOperationReservation = {
        tabId: TAB_ID,
        token: 1,
        readiness: Promise.resolve({
            revision: 1,
            content: { kind: SIDE_PANEL_CONTENT_KIND.PENDING, tabId: TAB_ID },
        }),
        completion: Promise.resolve({
            revision: 2,
            content: { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, tabId: TAB_ID, itemId: ITEM_ID },
        }),
    };
    return {
        cachedEnabled: vi.fn(() => cached),
        readEnabled: vi.fn(async () => stored),
        reserveExpectedNavigation: vi.fn(() => expected),
        reserveExplicitOperation: vi.fn(() => explicit),
        prepareExplicitOperation: vi.fn(async () => undefined),
        cancelExpectedNavigation: vi.fn(),
        cancelExplicitOperation: vi.fn(),
        openSidePanel: vi.fn(async () => undefined),
        setSelection: vi.fn(async () => undefined),
        warn: vi.fn(),
    };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('respondToArticleClick', () => {
    it('opens the panel synchronously and records the selection when enabled', async () => {
        const deps = dependencies(true);

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );

        // The user gesture survives only a synchronous call: the panel must be
        // opening before any awaited work resolves.
        expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        await settle();
        expect(deps.reserveExpectedNavigation).toHaveBeenCalledExactlyOnceWith(
            TAB_ID,
            WINDOW_ID,
            ARTICLE_URL,
        );
        expect(deps.reserveExplicitOperation).toHaveBeenCalledExactlyOnceWith(TAB_ID, WINDOW_ID);
        expect(deps.prepareExplicitOperation).toHaveBeenCalledOnce();
        expect(deps.setSelection).toHaveBeenCalledWith(expect.objectContaining({
            tabId: TAB_ID,
            windowId: WINDOW_ID,
            itemId: ITEM_ID,
            sourceUrl: ARTICLE_URL,
        }));
        expect(deps.readEnabled).not.toHaveBeenCalled();
        expect(deps.warn).not.toHaveBeenCalled();
    });

    it('does nothing when the cached setting is disabled', async () => {
        const deps = dependencies(false);

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );
        await settle();

        expect(deps.openSidePanel).not.toHaveBeenCalled();
        expect(deps.setSelection).not.toHaveBeenCalled();
        expect(deps.reserveExpectedNavigation).not.toHaveBeenCalled();
    });

    it('falls back to the stored setting when the cache is cold', async () => {
        const deps = dependencies(undefined, true);

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );

        expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        await settle();
        expect(deps.readEnabled).toHaveBeenCalledOnce();
        expect(deps.setSelection).toHaveBeenCalledOnce();
    });

    it('reserves precedence and opens before a cold setting read settles', async () => {
        let resolveEnabled: (enabled: boolean) => void = () => undefined;
        const enabled = new Promise<boolean>((resolve) => {
            resolveEnabled = resolve;
        });
        const deps = dependencies(undefined);
        vi.mocked(deps.readEnabled).mockReturnValueOnce(enabled);

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );

        expect(deps.reserveExpectedNavigation).toHaveBeenCalledOnce();
        expect(deps.reserveExplicitOperation).toHaveBeenCalledOnce();
        expect(deps.prepareExplicitOperation).toHaveBeenCalledOnce();
        expect(deps.openSidePanel).toHaveBeenCalledOnce();
        expect(deps.setSelection).not.toHaveBeenCalled();
        resolveEnabled(false);
        await settle();
        expect(deps.cancelExpectedNavigation).toHaveBeenCalledOnce();
        expect(deps.cancelExplicitOperation).toHaveBeenCalledOnce();
    });

    it('cancels and resynchronizes when the cold setting read fails', async () => {
        const deps = dependencies(undefined);
        vi.mocked(deps.readEnabled).mockRejectedValueOnce(new Error('storage unavailable'));

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );
        await settle();

        expect(deps.cancelExpectedNavigation).toHaveBeenCalledOnce();
        expect(deps.cancelExplicitOperation).toHaveBeenCalledWith(
            expect.anything(),
            WINDOW_ID,
            true,
        );
        expect(deps.warn).toHaveBeenCalledWith(
            FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED,
            { tabId: TAB_ID, windowId: WINDOW_ID },
        );
    });

    it('keeps the selection untouched when the stored setting is disabled', async () => {
        const deps = dependencies(undefined, false);

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );
        await settle();

        // A page injected before the setting was turned off can still send
        // clicks; the authoritative read blocks the selection write, and the
        // registration itself is the gate for freshly loaded pages.
        expect(deps.readEnabled).toHaveBeenCalledOnce();
        expect(deps.setSelection).not.toHaveBeenCalled();
        expect(deps.cancelExpectedNavigation).toHaveBeenCalledOnce();
        expect(deps.cancelExplicitOperation).toHaveBeenCalledWith(
            expect.anything(),
            WINDOW_ID,
            true,
        );
    });

    it.each([
        { name: 'a missing tab', sender: { windowId: WINDOW_ID, origin: HN_ORIGIN } },
        { name: 'a missing window', sender: { tabId: TAB_ID, origin: HN_ORIGIN } },
        {
            name: 'a foreign origin',
            sender: { tabId: TAB_ID, windowId: WINDOW_ID, origin: 'https://evil.example' },
        },
        {
            name: 'an extension origin',
            sender: { tabId: TAB_ID, windowId: WINDOW_ID, origin: 'chrome-extension://abcdef' },
        },
        { name: 'no origin at all', sender: { tabId: TAB_ID, windowId: WINDOW_ID } },
    ])('ignores a click message from $name', async ({ sender }) => {
        const deps = dependencies(true);

        respondToArticleClick({ itemId: ITEM_ID, articleUrl: ARTICLE_URL }, sender, HN_ORIGIN, deps);
        await settle();

        expect(deps.openSidePanel).not.toHaveBeenCalled();
        expect(deps.setSelection).not.toHaveBeenCalled();
    });

    it('still records the selection when opening the panel fails', async () => {
        const deps = dependencies(true);
        vi.mocked(deps.openSidePanel).mockRejectedValueOnce(new Error('gesture consumed'));

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );
        await settle();

        expect(deps.setSelection).toHaveBeenCalledOnce();
        expect(deps.warn).toHaveBeenCalledWith(
            FOLLOW_DIAGNOSTIC_CODE.OPEN_FAILED,
            { tabId: TAB_ID, windowId: WINDOW_ID },
        );
    });

    it('reports a failed selection write without throwing', async () => {
        const deps = dependencies(true);
        vi.mocked(deps.setSelection).mockRejectedValueOnce(new Error('storage unavailable'));

        respondToArticleClick(
            { itemId: ITEM_ID, articleUrl: ARTICLE_URL },
            { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN },
            HN_ORIGIN,
            deps,
        );
        await settle();

        expect(deps.warn).toHaveBeenCalledWith(
            FOLLOW_DIAGNOSTIC_CODE.SELECTION_FAILED,
            { tabId: TAB_ID, windowId: WINDOW_ID },
        );
    });
});

import { describe, expect, it, vi } from 'vitest';

import { respondToArticleClick } from '../src/browser/article-click-open';
import type { ArticleClickOpenDependencies } from '../src/browser/article-click-open';

const HN_ORIGIN = 'https://news.ycombinator.com';
const ITEM_ID = '424242';
const TAB_ID = 7;
const WINDOW_ID = 3;

function dependencies(cached: boolean | undefined, stored = true): ArticleClickOpenDependencies {
    return {
        cachedEnabled: vi.fn(() => cached),
        readEnabled: vi.fn(async () => stored),
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

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);

        // The user gesture survives only a synchronous call: the panel must be
        // opening before any awaited work resolves.
        expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        await settle();
        expect(deps.setSelection).toHaveBeenCalledExactlyOnceWith(ITEM_ID, WINDOW_ID);
        expect(deps.readEnabled).not.toHaveBeenCalled();
        expect(deps.warn).not.toHaveBeenCalled();
    });

    it('does nothing when the cached setting is disabled', async () => {
        const deps = dependencies(false);

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);
        await settle();

        expect(deps.openSidePanel).not.toHaveBeenCalled();
        expect(deps.setSelection).not.toHaveBeenCalled();
    });

    it('falls back to the stored setting when the cache is cold', async () => {
        const deps = dependencies(undefined, true);

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);

        expect(deps.openSidePanel).toHaveBeenCalledExactlyOnceWith(TAB_ID);
        await settle();
        expect(deps.readEnabled).toHaveBeenCalledOnce();
        expect(deps.setSelection).toHaveBeenCalledExactlyOnceWith(ITEM_ID, WINDOW_ID);
    });

    it('keeps the selection untouched when the stored setting is disabled', async () => {
        const deps = dependencies(undefined, false);

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);
        await settle();

        // A page injected before the setting was turned off can still send
        // clicks; the authoritative read blocks the selection write, and the
        // registration itself is the gate for freshly loaded pages.
        expect(deps.readEnabled).toHaveBeenCalledOnce();
        expect(deps.setSelection).not.toHaveBeenCalled();
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

        respondToArticleClick(ITEM_ID, sender, HN_ORIGIN, deps);
        await settle();

        expect(deps.openSidePanel).not.toHaveBeenCalled();
        expect(deps.setSelection).not.toHaveBeenCalled();
    });

    it('still records the selection when opening the panel fails', async () => {
        const deps = dependencies(true);
        vi.mocked(deps.openSidePanel).mockRejectedValueOnce(new Error('gesture consumed'));

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);
        await settle();

        expect(deps.setSelection).toHaveBeenCalledExactlyOnceWith(ITEM_ID, WINDOW_ID);
        expect(deps.warn).toHaveBeenCalledOnce();
    });

    it('reports a failed selection write without throwing', async () => {
        const deps = dependencies(true);
        vi.mocked(deps.setSelection).mockRejectedValueOnce(new Error('storage unavailable'));

        respondToArticleClick(ITEM_ID, { tabId: TAB_ID, windowId: WINDOW_ID, origin: HN_ORIGIN }, HN_ORIGIN, deps);
        await settle();

        expect(deps.warn).toHaveBeenCalledOnce();
    });
});

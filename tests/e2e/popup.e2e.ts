import { expect, test } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };

import {
    ARTICLE_ORIGIN,
    installLookupFixtures,
    launchExtensionContext,
    openExtensionPage,
    shimPopupBrowserCalls,
} from './extension-context';

import type { AlgoliaHitFixture, ExtensionContext } from './extension-context';
import type { Page } from '@playwright/test';

const ARTICLE_URL = `${ARTICLE_ORIGIN}/popup-article`;
const HN_ORIGIN = 'https://news.ycombinator.com';
const PRIMARY_ITEM_ID = '515151';
const ALTERNATIVE_ITEM_ID = '515152';

const FIXTURE_HITS: AlgoliaHitFixture[] = [
    {
        objectID: PRIMARY_ITEM_ID,
        title: 'Primary fixture discussion',
        num_comments: 12,
        points: 30,
        created_at_i: 1_700_000_000,
    },
    {
        objectID: ALTERNATIVE_ITEM_ID,
        title: 'Alternative fixture discussion',
        num_comments: 3,
        points: 8,
        created_at_i: 1_700_000_100,
    },
];

/**
 * Opens the real popup page with a live article tab backing it, so a
 * discussion click reaches the real background tab-opening wiring end to end
 * instead of failing on a `chrome.tabs.get` call for a tab id nothing created.
 *
 * @param extension - The launched extension context.
 * @param articleTabId - The real browser tab id the popup reports as active.
 */
async function openPopupForArticleTab(extension: ExtensionContext, articleTabId: number): Promise<Page> {
    return openExtensionPage(extension, 'popup.html', {
        beforeNavigate: async (target) => {
            await shimPopupBrowserCalls(target, { articleTabId, pageUrl: ARTICLE_URL });
        },
    });
}

test('clicking a search result in the real popup opens exactly that item, never the other one', async () => {
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext();
        await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });
        await extension.context.route(ARTICLE_URL, async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Fixture article</title><main><h1>Fixture article</h1></main>',
            });
        });
        await extension.context.route(`${HN_ORIGIN}/item?**`, async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Fixture Hacker News comments</title>',
            });
        });

        const article = await extension.context.newPage();
        await article.goto(ARTICLE_URL);
        await article.bringToFront();
        const articleTabId = await extension.worker.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id === undefined) {
                throw new Error('The active article tab has no Chrome tab identifier');
            }
            return tab.id;
        });

        // Click the alternative, not the primary: a copy-paste bug that wires
        // every alternative button to the primary's item id (or vice versa)
        // must fail this test, not just a unit test of the button wiring.
        const popup = await openPopupForArticleTab(extension, articleTabId);
        const alternativeButton = popup.getByRole('button', { name: /Open alternative/ });
        await expect(alternativeButton).toBeVisible();
        await alternativeButton.click();

        const alternativeUrl = `${HN_ORIGIN}/item?id=${ALTERNATIVE_ITEM_ID}`;
        const primaryUrl = `${HN_ORIGIN}/item?id=${PRIMARY_ITEM_ID}`;
        await expect.poll(() => extension?.context.pages().map((page) => page.url()) ?? [])
            .toContain(alternativeUrl);
        expect(extension.context.pages().some((page) => page.url() === primaryUrl)).toBe(false);

        await popup.close();
        await article.close();
    } finally {
        await extension?.dispose();
    }
});

for (const nativeRejected of [false, true]) {
    test(`primary popup result opens exactly one item (native API rejected: ${nativeRejected})`, async () => {
        let extension: ExtensionContext | undefined;
        try {
            extension = await launchExtensionContext();
            await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });
            await extension.context.route(ARTICLE_URL, async (route) => {
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><title>Fixture article</title><main><h1>Fixture article</h1></main>',
                });
            });
            await extension.context.route(`${HN_ORIGIN}/item?**`, async (route) => {
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><title>Fixture Hacker News comments</title>',
                });
            });

            const article = await extension.context.newPage();
            await article.goto(ARTICLE_URL);
            await article.bringToFront();
            const articleTabId = await extension.worker.evaluate(async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id === undefined) {
                    throw new Error('The active article tab has no Chrome tab identifier');
                }
                return tab.id;
            });

            const popup = await openPopupForArticleTab(extension, articleTabId);
            const nativeCheckbox = popup.getByRole('checkbox', { name: enMessages.native_split_experiment.message });
            await expect(nativeCheckbox).not.toBeChecked();
            if (nativeRejected) {
                await extension.worker.evaluate(() => {
                    const calls: [number, number][] = [];
                    Object.assign(globalThis, { nativeSplitFixtureCalls: calls });
                    Object.defineProperty(chrome.tabs, 'createSplit', {
                        configurable: true,
                        value: async (tabIds: [number, number]) => {
                            calls.push(tabIds);
                            throw new Error('Native Split View unavailable in fixture');
                        },
                    });
                });
                await nativeCheckbox.check();
            }
            const primaryButton = popup.getByRole('button', { name: /^Open discussion/ });
            await expect(primaryButton).toBeVisible();
            await primaryButton.click();

            const primaryUrl = `${HN_ORIGIN}/item?id=${PRIMARY_ITEM_ID}`;
            const alternativeUrl = `${HN_ORIGIN}/item?id=${ALTERNATIVE_ITEM_ID}`;
            await expect.poll(() => extension?.context.pages().map((page) => page.url()) ?? [])
                .toContain(primaryUrl);
            expect(extension.context.pages().some((page) => page.url() === alternativeUrl)).toBe(false);
            expect(extension.context.pages().filter((page) => page.url().startsWith(`${HN_ORIGIN}/item?`)))
                .toHaveLength(1);

            if (nativeRejected) {
                await expect.poll(async () => extension?.worker.evaluate(() => (
                    (globalThis as typeof globalThis & {
                        nativeSplitFixtureCalls: [number, number][];
                    }).nativeSplitFixtureCalls.length
                ))).toBe(1);
                const calls = await extension.worker.evaluate(() => (
                    (globalThis as typeof globalThis & {
                        nativeSplitFixtureCalls: [number, number][];
                    }).nativeSplitFixtureCalls
                ));
                expect(calls).toHaveLength(1);
                expect(calls[0]?.[0]).toBe(articleTabId);
                const liveTabIds = await extension.worker.evaluate(async () => (
                    (await chrome.tabs.query({})).map((tab) => tab.id)
                ));
                expect(liveTabIds).toContain(calls[0]?.[1]);
            }
            await popup.close();
            await article.close();
        } finally {
            await extension?.dispose();
        }
    });
}

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
        const alternativeButton = popup.getByRole('button', { name: enMessages.open_alternative.message });
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

test('clicking the primary result in the real popup opens exactly the primary item', async () => {
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
        const primaryButton = popup.getByRole('button', { name: /^Open discussion/ });
        await expect(primaryButton).toBeVisible();
        await primaryButton.click();

        const primaryUrl = `${HN_ORIGIN}/item?id=${PRIMARY_ITEM_ID}`;
        const alternativeUrl = `${HN_ORIGIN}/item?id=${ALTERNATIVE_ITEM_ID}`;
        await expect.poll(() => extension?.context.pages().map((page) => page.url()) ?? [])
            .toContain(primaryUrl);
        expect(extension.context.pages().some((page) => page.url() === alternativeUrl)).toBe(false);

        const opened = await extension.worker.evaluate(async ({ sourceId, url }) => {
            const allTabs = await chrome.tabs.query({ currentWindow: true });
            return {
                nativeAvailable: typeof (chrome.tabs as { createSplit?: unknown }).createSplit === 'function',
                article: allTabs.find(({ id }) => id === sourceId),
                discussions: allTabs.filter((tab) => tab.url === url),
                count: allTabs.length,
            };
        }, { sourceId: articleTabId, url: primaryUrl });
        test.info().annotations.push(
            { type: 'browser-version', description: extension.context.browser()?.version() ?? 'unknown' },
            { type: 'native-split-api', description: String(opened.nativeAvailable) },
        );
        expect(opened.discussions).toHaveLength(1);
        if (opened.nativeAvailable) {
            expect(opened.article?.splitViewId).toBeGreaterThanOrEqual(0);
            expect(opened.discussions[0]?.splitViewId).toBe(opened.article?.splitViewId);
        }

        // A second real result click must navigate the same pane, not create a duplicate.
        await popup.getByRole('button', { name: enMessages.open_alternative.message }).click();
        await expect.poll(() => extension?.context.pages().map((page) => page.url()) ?? [])
            .toContain(alternativeUrl);
        const reused = await extension.worker.evaluate(async (tabId) => ({
            discussion: await chrome.tabs.get(tabId),
            count: (await chrome.tabs.query({ currentWindow: true })).length,
        }), opened.discussions[0]!.id!);
        expect(reused.discussion.url).toBe(alternativeUrl);
        expect(reused.count).toBe(opened.count);
        expect(reused.discussion.splitViewId).toBe(opened.discussions[0]?.splitViewId);

        if (opened.nativeAvailable) {
            // Exercise createSplit on existing tabs after the browser removes their pairing.
            await extension.worker.evaluate(async (splitViewId) => {
                const nativeTabs = chrome.tabs as typeof chrome.tabs & {
                    unsplit(splitId: number): Promise<void>;
                };
                await nativeTabs.unsplit(splitViewId);
            }, opened.article!.splitViewId!);
            await primaryButton.click();
            await expect.poll(() => extension?.context.pages().map((page) => page.url()) ?? [])
                .toContain(primaryUrl);
            await expect.poll(async () => extension!.worker.evaluate(async ([sourceId, discussionId]) => {
                const source = await chrome.tabs.get(sourceId!);
                const pane = await chrome.tabs.get(discussionId!);
                return source.splitViewId !== undefined && source.splitViewId !== -1
                    && source.splitViewId === pane.splitViewId;
            }, [articleTabId, opened.discussions[0]!.id!])).toBe(true);
            const countAfterPairing = await extension.worker.evaluate(async () => (
                (await chrome.tabs.query({ currentWindow: true })).length
            ));
            expect(countAfterPairing).toBe(opened.count);
        }

        await popup.close();
        await article.close();
    } finally {
        await extension?.dispose();
    }
});

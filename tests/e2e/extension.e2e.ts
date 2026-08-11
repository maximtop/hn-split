import { expect, test } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { ARTICLE_ORIGIN, launchExtensionContext, openExtensionPage } from './extension-context';
import type { ExtensionContext } from './extension-context';

const ARTICLE_URL = `${ARTICLE_ORIGIN}/story`;
const AUTOMATIC_ARTICLE_URL = `${ARTICLE_ORIGIN}/automatic-story`;
const FIRST_ITEM_ID = '424242';
const SECOND_ITEM_ID = '424243';

interface LookupResponse {
    ok: boolean;
    result?: {
        status: string;
        primary?: { id: string; comments: number };
    };
    error?: string;
}

interface OpenResponse {
    ok: boolean;
    result?: {
        tabId: number;
        mode: 'adjacent_tab' | 'reused_tab' | 'split_view';
    };
    error?: string;
}

test('loads the unpacked extension and verifies lookup plus adjacent tab reuse', async () => {
    let extension: ExtensionContext | undefined;

    try {
        extension = await launchExtensionContext();
        const { context, worker } = extension;

        let algoliaRequests = 0;
        let signalAutomaticLookup!: () => void;
        let releaseAutomaticLookup!: () => void;
        const automaticLookupStarted = new Promise<void>((resolveStarted) => {
            signalAutomaticLookup = resolveStarted;
        });
        const automaticLookupGate = new Promise<void>((resolveLookup) => {
            releaseAutomaticLookup = resolveLookup;
        });
        await context.route(ARTICLE_URL, async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><title>HN Split fixture article</title>
                    <link rel="canonical" href="${ARTICLE_URL}">
                    <main><h1>Fixture article</h1></main>`,
            });
        });
        await context.route(AUTOMATIC_ARTICLE_URL, async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Automatic fixture article</title><main><h1>Automatic fixture</h1></main>',
            });
        });
        await context.route('https://hn.algolia.com/api/v1/search**', async (route) => {
            algoliaRequests += 1;
            const query = new URL(route.request().url()).searchParams.get('query');
            if (query === AUTOMATIC_ARTICLE_URL) {
                signalAutomaticLookup();
                await automaticLookupGate;
            }
            await route.fulfill({
                contentType: 'application/json',
                json: {
                    hits: [{
                        objectID: FIRST_ITEM_ID,
                        url: query === AUTOMATIC_ARTICLE_URL ? AUTOMATIC_ARTICLE_URL : ARTICLE_URL,
                        title: 'Fixture Hacker News discussion',
                        num_comments: 37,
                        points: 81,
                        created_at_i: 1_700_000_000,
                    }],
                },
            });
        });
        await context.route('https://news.ycombinator.com/item?**', async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Fixture Hacker News comments</title>',
            });
        });

        const article = context.pages()[0] ?? await context.newPage();
        await article.goto(ARTICLE_URL);
        await article.bringToFront();
        await expect(article.locator('h1')).toHaveText('Fixture article');

        const articleTabId = await worker.evaluate(async () => {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return activeTab?.id;
        });
        expect(typeof articleTabId).toBe('number');

        const options = await openExtensionPage(extension, 'options.html');
        await expect(options).toHaveTitle(enMessages.options_document_title.message);
        await expect(options.getByRole('heading', {
            name: enMessages.options_heading.message,
        })).toBeVisible();
        await expect(options.getByRole('switch', {
            name: enMessages.automatic_badge_label.message,
        })).not.toBeChecked();

        const hasRequiredTabsPermission = await worker.evaluate(async () => chrome.permissions.contains({
            permissions: ['tabs'],
        }));
        expect(hasRequiredTabsPermission).toBe(true);

        await article.goto(AUTOMATIC_ARTICLE_URL);
        const enableDuringLookup = options.evaluate(async () => chrome.runtime.sendMessage({
            type: 'set_availability_setting',
            enabled: true,
        }));
        await automaticLookupStarted;
        const disableDuringLookup = options.evaluate(async () => chrome.runtime.sendMessage({
            type: 'set_availability_setting',
            enabled: false,
        }));
        releaseAutomaticLookup();
        await expect(enableDuringLookup).resolves.toMatchObject({ ok: true });
        await expect(disableDuringLookup).resolves.toMatchObject({ ok: true });
        const stateAfterConcurrentDisable = await worker.evaluate(async (tabId) => ({
            enabled: (await chrome.storage.local.get('automatic_availability')).automatic_availability,
            badge: await chrome.action.getBadgeText({ tabId }),
            sessionKeys: Object.keys(await chrome.storage.session.get(null)),
        }), articleTabId as number);
        expect(stateAfterConcurrentDisable.enabled).toBe(false);
        expect(stateAfterConcurrentDisable.badge).toBe('');
        expect(stateAfterConcurrentDisable.sessionKeys.filter((key) => key.startsWith('hn_lookup_v1:')))
            .toEqual([]);

        await article.goto(ARTICLE_URL);
        const lookup = await options.evaluate(async ({ pageUrl }): Promise<LookupResponse> => (
            chrome.runtime.sendMessage({
                type: 'lookup',
                context: { pageUrl, canonicalHref: pageUrl },
            })
        ), { pageUrl: ARTICLE_URL });
        expect(lookup).toMatchObject({
            ok: true,
            result: {
                status: 'found',
                primary: { id: FIRST_ITEM_ID, comments: 37 },
            },
        });
        expect(algoliaRequests).toBe(2);

        const automaticSwitch = options.getByRole('switch', {
            name: enMessages.automatic_badge_label.message,
        });
        await automaticSwitch.press('Space');
        await expect(automaticSwitch).toBeChecked();
        await expect.poll(async () => worker.evaluate(
            async (tabId) => chrome.action.getBadgeText({ tabId }),
            articleTabId as number,
        )).toBe('37');

        await automaticSwitch.press('Space');
        await expect(automaticSwitch).not.toBeChecked();
        await expect.poll(async () => worker.evaluate(
            async (tabId) => chrome.action.getBadgeText({ tabId }),
            articleTabId as number,
        )).toBe('');
        const sessionKeysAfterDisable = await worker.evaluate(async () => (
            Object.keys(await chrome.storage.session.get(null))
        ));
        expect(sessionKeysAfterDisable.filter((key) => key.startsWith('hn_lookup_v1:'))).toEqual([]);

        const firstOpen = await options.evaluate(async ({ tabId, itemId }): Promise<OpenResponse> => (
            chrome.runtime.sendMessage({
                type: 'open_discussion',
                articleTabId: tabId,
                itemId,
            })
        ), { tabId: articleTabId as number, itemId: FIRST_ITEM_ID });
        expect(firstOpen).toMatchObject({ ok: true, result: { mode: 'adjacent_tab' } });

        const firstDiscussionTabId = firstOpen.result?.tabId;
        expect(typeof firstDiscussionTabId).toBe('number');
        const firstTabs = await options.evaluate(async () => chrome.tabs.query({ currentWindow: true }));
        const articleTab = firstTabs.find(({ id }) => id === articleTabId);
        const firstDiscussionTab = firstTabs.find(({ id }) => id === firstDiscussionTabId);
        expect(firstDiscussionTab?.index).toBe((articleTab?.index ?? -2) + 1);
        const firstDiscussionUrl = `https://news.ycombinator.com/item?id=${FIRST_ITEM_ID}`;
        await expect.poll(() => context?.pages().map((page) => page.url()) ?? [])
            .toContain(firstDiscussionUrl);
        const discussionPage = context.pages().find((page) => page.url() === firstDiscussionUrl);
        expect(discussionPage).toBeDefined();

        const secondOpen = await options.evaluate(async ({ tabId, itemId }): Promise<OpenResponse> => (
            chrome.runtime.sendMessage({
                type: 'open_discussion',
                articleTabId: tabId,
                itemId,
            })
        ), { tabId: articleTabId as number, itemId: SECOND_ITEM_ID });
        expect(secondOpen).toMatchObject({
            ok: true,
            result: { tabId: firstDiscussionTabId, mode: 'reused_tab' },
        });

        const finalTabs = await options.evaluate(async () => chrome.tabs.query({ currentWindow: true }));
        expect(finalTabs).toHaveLength(firstTabs.length);
        const secondDiscussionUrl = `https://news.ycombinator.com/item?id=${SECOND_ITEM_ID}`;
        await discussionPage?.waitForURL(secondDiscussionUrl);
        expect(discussionPage?.url()).toBe(secondDiscussionUrl);
        expect(context.pages().filter((page) => page.url().startsWith('https://news.ycombinator.com/item?')))
            .toHaveLength(1);
    } finally {
        await extension?.dispose();
    }
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { discussionUrl } from '../../src/domain/hn';
import {
    BACKGROUND_REQUEST_TYPE,
    isSidePanelContentResponse,
} from '../../src/shared/messages';
import {
    STORAGE_KEY,
} from '../../src/shared/storage-keys';
import {
    ARTICLE_ORIGIN,
    installPerArticleLookupFixtures,
    launchExtensionContext,
    openExtensionPage,
} from './extension-context';
import type { ExtensionContext } from './extension-context';

const ITEM_ID = '424242';
const ITEM_A = '424243';
const ITEM_B = '424244';
const FRAMING_RULE_ID = 1;

/**
 * Identifies one real browser tab and its owning window.
 */
interface BrowserTabIdentity {
    /**
     * Identifies the Chrome tab.
     */
    tabId: number;
    /**
     * Identifies the Chrome window that owns the tab.
     */
    windowId: number;
}

/**
 * Resolves one exact fixture page to its Chrome tab and window identifiers.
 * @param extension - The launched extension context.
 * @param url - The exact fixture page URL.
 */
async function browserTabIdentity(
    extension: ExtensionContext,
    url: string,
): Promise<BrowserTabIdentity> {
    return extension.worker.evaluate(async (pageUrl) => {
        const [tab] = await chrome.tabs.query({ url: pageUrl });
        if (tab?.id === undefined) {
            throw new Error('Fixture page has no Chrome tab identifier');
        }
        return { tabId: tab.id, windowId: tab.windowId };
    }, url);
}

/**
 * Selects a discussion through the manager-owned public protocol only after
 * the panel has completed its initial framing handshake.
 * @param panel - The connected extension panel test page.
 * @param identity - The real article tab and window that own the discussion.
 * @param itemId - The concrete Hacker News item to display.
 * @param sourceUrl - The real source article URL used for identity association.
 */
async function selectPanelDiscussion(
    panel: Page,
    identity: BrowserTabIdentity,
    itemId: string,
    sourceUrl: string,
): Promise<void> {
    const response: unknown = await panel.evaluate(async (request) => (
        chrome.runtime.sendMessage(request)
    ), {
        type: BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION,
        tabId: identity.tabId,
        windowId: identity.windowId,
        itemId,
        sourceUrl,
    });
    if (!isSidePanelContentResponse(response) || !response.ok) {
        throw new Error('Unable to select the fixture discussion');
    }
}

/**
 * Enables the independent follow preference directly for a deterministic
 * activation-driven E2E scenario.
 * @param extension - The launched extension context.
 */
async function enableFollowFixture(extension: ExtensionContext): Promise<void> {
    await extension.worker.evaluate(async ({ key }) => {
        await chrome.storage.local.set({ [key]: true });
    }, { key: STORAGE_KEY.SIDE_PANEL_FOLLOW });
}

/**
 * Waits for one visible discussion frame and its deterministic document body.
 * @param panel - The connected panel test page.
 * @param itemId - The expected concrete Hacker News item.
 */
async function expectVisibleDiscussion(panel: Page, itemId: string): Promise<void> {
    const frame = panel.locator('iframe:not([hidden])');
    await expect(frame).toHaveAttribute('src', discussionUrl(itemId));
    await expect(panel.frameLocator('iframe:not([hidden])').getByRole('heading', {
        name: 'Fixture discussion',
    })).toBeVisible();
}

/**
 * Verifies the framing exception is scoped to a live panel and that a strict
 * post-connect source-tab projection frames the selected discussion.
 */
test('installs the framing exception only while the side panel is open', async () => {
    let extension: ExtensionContext | undefined;

    try {
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        const { context, worker } = extension;
        await installPerArticleLookupFixtures(context, { '/framing': ITEM_ID });
        const source = await context.newPage();
        const sourceUrl = `${ARTICLE_ORIGIN}/framing`;
        await source.goto(sourceUrl);
        const sourceIdentity = await browserTabIdentity(extension, sourceUrl);

        const rulesBefore = await worker.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
        expect(rulesBefore).toEqual([]);

        const panel = await openExtensionPage(extension, 'side-panel.html');
        await expect(panel.getByRole('button', {
            name: enMessages.side_panel_check_this_tab.message,
        })).toBeVisible();
        await expect.poll(async () => worker.evaluate(
            async () => (await chrome.declarativeNetRequest.getDynamicRules()).length,
        )).toBe(1);

        await selectPanelDiscussion(
            panel,
            sourceIdentity,
            ITEM_ID,
            sourceUrl,
        );

        await expect(panel.getByText(enMessages.side_panel_notice.message)).toHaveCount(0);
        await expectVisibleDiscussion(panel, ITEM_ID);

        const rulesWhileOpen = await worker.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
        expect(rulesWhileOpen).toMatchObject([{
            id: FRAMING_RULE_ID,
            action: { type: 'modifyHeaders' },
            condition: { resourceTypes: ['sub_frame'] },
        }]);

        await panel.close();
        await expect.poll(async () => worker.evaluate(
            async () => (await chrome.declarativeNetRequest.getDynamicRules()).length,
        )).toBe(0);

        const options = await openExtensionPage(extension, 'options.html');
        await expect(options.getByText(enMessages.side_panel_notice.message)).toBeVisible();
    } finally {
        await extension?.dispose();
    }
});

test('an open opted-in panel follows the latest active tab without stale content', async () => {
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        await installPerArticleLookupFixtures(extension.context, { '/a': ITEM_ID, '/b': null });
        const articleA = await extension.context.newPage();
        await articleA.goto(`${ARTICLE_ORIGIN}/a`);
        const articleB = await extension.context.newPage();
        await articleB.goto(`${ARTICLE_ORIGIN}/b`);
        const panel = await openExtensionPage(extension, 'side-panel.html');
        await expect(panel.getByRole('button', {
            name: enMessages.side_panel_check_this_tab.message,
        })).toBeVisible();
        await enableFollowFixture(extension);

        await articleA.bringToFront();
        await expectVisibleDiscussion(panel, ITEM_ID);
        await articleB.bringToFront();
        await expect(panel.getByText(enMessages.discussion_not_found.message)).toBeVisible();
        await expect(panel.locator('iframe:not([hidden])')).toHaveCount(0);
    } finally {
        await extension?.dispose();
    }
});

test('manual mode performs no lookup until one panel action is clicked', async () => {
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        const capture = await installPerArticleLookupFixtures(
            extension.context,
            { '/manual': null },
        );
        const articleUrl = `${ARTICLE_ORIGIN}/manual`;
        const article = await extension.context.newPage();
        await article.goto(articleUrl);
        const panel = await openExtensionPage(extension, 'side-panel.html');
        await article.bringToFront();
        const identity = await browserTabIdentity(extension, articleUrl);
        await expect.poll(async () => extension?.worker.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab?.id ?? null;
        })).toBe(identity.tabId);
        const check = panel.getByRole('button', {
            name: enMessages.side_panel_check_this_tab.message,
        });
        await expect(check).toBeVisible();
        expect(capture.algoliaRequests).toEqual([]);
        expect(capture.discussionFrameRequests).toEqual([]);

        await check.evaluate((element: HTMLButtonElement) => element.click());

        await expect.poll(() => capture.algoliaRequests.length).toBe(1);
        await expect(panel.getByText(enMessages.discussion_not_found.message)).toBeVisible();
        expect(capture.algoliaRequests).toHaveLength(1);
        expect(capture.discussionFrameRequests).toEqual([]);
    } finally {
        await extension?.dispose();
    }
});

test('a retained iframe keeps its browser-owned scroll position while retained', async () => {
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        await installPerArticleLookupFixtures(extension.context, { '/a': ITEM_A, '/b': ITEM_B });
        const articleA = await extension.context.newPage();
        const articleB = await extension.context.newPage();
        await articleA.goto(`${ARTICLE_ORIGIN}/a`);
        await articleB.goto(`${ARTICLE_ORIGIN}/b`);
        const panel = await openExtensionPage(extension, 'side-panel.html');
        await expect(panel.getByRole('button', {
            name: enMessages.side_panel_check_this_tab.message,
        })).toBeVisible();
        await enableFollowFixture(extension);

        await articleA.bringToFront();
        await expectVisibleDiscussion(panel, ITEM_A);
        const frameA = panel.frame({ url: new RegExp(`item\\?id=${ITEM_A}$`) });
        expect(frameA).not.toBeNull();
        await frameA?.evaluate(() => window.scrollTo(0, 1200));

        await articleB.bringToFront();
        await expectVisibleDiscussion(panel, ITEM_B);
        await articleA.bringToFront();
        await expectVisibleDiscussion(panel, ITEM_A);
        expect(panel.frame({ url: new RegExp(`item\\?id=${ITEM_A}$`) })).toBe(frameA);
        await expect.poll(async () => frameA?.evaluate(() => window.scrollY)).toBe(1200);
    } finally {
        await extension?.dispose();
    }
});

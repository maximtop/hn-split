import { expect, test } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { OPEN_IN_SPLIT_MENU } from '../../src/shared/context-menus';
import { SESSION_STORAGE_KEY_PREFIX } from '../../src/shared/storage-keys';
import { ARTICLE_ORIGIN, installLookupFixtures, launchExtensionContext, openExtensionPage } from './extension-context';
import type { ExtensionContext } from './extension-context';

const HN_ORIGIN = 'https://news.ycombinator.com';
const SOURCE_PATH = '/links';
const LINK_PATH = '/story';
const ITEM_ID = '424242';

const HIT = {
    objectID: ITEM_ID,
    title: 'Fixture discussion',
    num_comments: 12,
    points: 34,
    created_at_i: 1,
};

/**
 * Reads what the side panel is currently asked to display. The selection is
 * stored per window and the test runs in a single window, so the one entry
 * under the prefix is the selection of that window.
 * @param extension - The launched extension context.
 */
async function panelContent(extension: ExtensionContext): Promise<unknown> {
    return extension.worker.evaluate(async (prefix) => {
        const stored = await chrome.storage.session.get(null);
        const key = Object.keys(stored).find((candidate) => candidate.startsWith(prefix));
        return key === undefined ? undefined : stored[key];
    }, SESSION_STORAGE_KEY_PREFIX.SIDE_PANEL_DISCUSSION);
}

/**
 * Invokes the menu item the way Chrome does when the user selects it. The
 * click carries no user gesture here, so `chrome.sidePanel.open` rejects and
 * the flow's own error handling is what keeps the rest of it running.
 * @param extension - The launched extension context.
 * @param linkUrl - The link URL the menu was invoked on.
 */
async function selectOpenInSplit(extension: ExtensionContext, linkUrl: string): Promise<void> {
    await extension.worker.evaluate(async ({ menuItemId, url, sourceUrl }) => {
        const [tab] = await chrome.tabs.query({ url: sourceUrl });
        const clicked = chrome.contextMenus.onClicked as unknown as {
            dispatch: (info: unknown, tab: unknown) => void;
        };
        clicked.dispatch({ menuItemId, linkUrl: url, editable: false }, tab);
    }, {
        menuItemId: OPEN_IN_SPLIT_MENU.ID,
        url: linkUrl,
        sourceUrl: `${ARTICLE_ORIGIN}${SOURCE_PATH}`,
    });
}

/**
 * Verifies the whole link flow: the menu item exists, selecting it loads the
 * link in the tab it was invoked from, and the panel moves from the lookup to
 * the discussion. Both the article origin and Hacker News are served from
 * routes, so nothing depends on the live sites.
 */
test('the link menu opens the article in place and its discussion in the panel', async () => {
    let extension: ExtensionContext | undefined;

    try {
        extension = await launchExtensionContext();
        const active = extension;
        await installLookupFixtures(active.context, { hits: [HIT] });
        await active.context.route(`${HN_ORIGIN}/**`, async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                headers: { 'x-frame-options': 'DENY' },
                body: '<!doctype html><title>Fixture discussion</title><main><h1>Fixture discussion</h1></main>',
            });
        });

        // Chrome offers no way to enumerate menu items, but updating one
        // succeeds only while it exists.
        await expect.poll(async () => active.worker.evaluate(async (menuItemId) => {
            try {
                await chrome.contextMenus.update(menuItemId, { enabled: true });
                return true;
            } catch {
                return false;
            }
        }, OPEN_IN_SPLIT_MENU.ID)).toBe(true);

        const sourcePage = await active.context.newPage();
        await sourcePage.goto(`${ARTICLE_ORIGIN}${SOURCE_PATH}`);
        expect(await panelContent(active)).toBeUndefined();

        await selectOpenInSplit(active, `${ARTICLE_ORIGIN}${LINK_PATH}`);

        await sourcePage.waitForURL(`${ARTICLE_ORIGIN}${LINK_PATH}`);
        await expect.poll(async () => panelContent(active)).toEqual({
            kind: 'discussion',
            itemId: ITEM_ID,
        });

        const panel = await openExtensionPage(active, 'side-panel.html');
        await expect(panel.locator('iframe.discussion-frame'))
            .toHaveAttribute('src', `${HN_ORIGIN}/item?id=${ITEM_ID}`);
        await panel.close();
        await sourcePage.close();
    } finally {
        await extension?.dispose();
    }
});

/**
 * Verifies the flow states plainly that there is nothing to show, instead of
 * leaving the panel waiting, when the link has no discussion.
 */
test('the panel says so when the selected link has no discussion', async () => {
    let extension: ExtensionContext | undefined;

    try {
        extension = await launchExtensionContext();
        const active = extension;
        await installLookupFixtures(active.context, { hits: [] });

        const sourcePage = await active.context.newPage();
        await sourcePage.goto(`${ARTICLE_ORIGIN}${SOURCE_PATH}`);

        await selectOpenInSplit(active, `${ARTICLE_ORIGIN}${LINK_PATH}`);

        await sourcePage.waitForURL(`${ARTICLE_ORIGIN}${LINK_PATH}`);
        await expect.poll(async () => panelContent(active)).toEqual({
            kind: 'unavailable',
            reason: 'not_found',
        });

        const panel = await openExtensionPage(active, 'side-panel.html');
        await expect(panel.getByText(enMessages.discussion_not_found.message)).toBeVisible();
        await expect(panel.locator('iframe.discussion-frame')).toHaveCount(0);
        await panel.close();
        await sourcePage.close();
    } finally {
        await extension?.dispose();
    }
});

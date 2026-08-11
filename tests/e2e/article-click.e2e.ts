import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { HN_ORIGIN } from '../../src/domain/hn';
import { ARTICLE_CLICK_CONTENT_SCRIPT } from '../../src/shared/content-scripts';
import { SIDE_PANEL_CONTENT_KIND } from '../../src/shared/side-panel-content';
import { isSidePanelProjection } from '../../src/shared/side-panel-projection';
import { SESSION_STORAGE_KEY_PREFIX } from '../../src/shared/storage-keys';
import {
    ARTICLE_ORIGIN,
    launchExtensionContext,
    openExtensionPage,
} from './extension-context';
import type { ExtensionContext } from './extension-context';

const STORY_ONE = { id: '424242', path: '/story-one', title: 'Fixture story one' };
const STORY_TWO = { id: '424243', path: '/story-two', title: 'Fixture story two' };

/**
 * One realistic Hacker News listing row: the external story link inside
 * `.titleline`, the nested `from?site=` chip, and the subtext comments link.
 */
function storyRow(story: { id: string; path: string; title: string }): string {
    return `
        <tr class="athing submission" id="${story.id}">
            <td class="title"><span class="rank">1.</span></td>
            <td class="title">
                <span class="titleline"><a href="${ARTICLE_ORIGIN}${story.path}">${story.title}</a>
                    <span class="sitebit comhead"> (<a href="from?site=article.hn-split.example.com"><span class="sitestr">article.hn-split.example.com</span></a>)</span>
                </span>
            </td>
        </tr>
        <tr><td class="subtext"><a href="item?id=${story.id}">12&nbsp;comments</a></td></tr>
    `;
}

/**
 * Serves a deterministic Hacker News listing, comment pages, and article
 * pages, so no test traffic reaches live sites.
 * @param context - The extension browser context to install routes into.
 */
async function installArticleClickFixtures(context: BrowserContext): Promise<void> {
    await context.route(`${HN_ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/item') {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Fixture Hacker News comments</title>',
            });
            return;
        }
        await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><title>Fixture Hacker News</title><table>${storyRow(STORY_ONE)}${storyRow(STORY_TWO)}</table>`,
        });
    });
    await context.route(`${ARTICLE_ORIGIN}/**`, async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Fixture article</title><main><h1>Fixture article</h1></main>',
        });
    });
}

/**
 * Reads the registered content-script identifiers from the background worker.
 * @param extension - The launched extension context.
 */
async function registeredScriptIds(extension: ExtensionContext): Promise<string[]> {
    return extension.worker.evaluate(async () => {
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        return scripts.map((script) => script.id);
    });
}

/**
 * Reads the item identifier of the discussion currently shown in the panel, or
 * undefined while the panel has nothing to show. The selection is stored per
 * window and the test runs in a single window, so the one entry under the
 * prefix is the selection of that window.
 * @param extension - The launched extension context.
 */
async function sidePanelSelection(extension: ExtensionContext): Promise<unknown> {
    const candidate: unknown = await extension.worker.evaluate(async (prefix) => {
        const stored = await chrome.storage.session.get(null);
        const key = Object.keys(stored).find((candidate) => candidate.startsWith(prefix));
        return key === undefined ? undefined : stored[key];
    }, SESSION_STORAGE_KEY_PREFIX.SIDE_PANEL_DISCUSSION);
    return isSidePanelProjection(candidate)
        && candidate.content.kind === SIDE_PANEL_CONTENT_KIND.DISCUSSION
        ? candidate.content.itemId
        : undefined;
}

/**
 * Counts the open top-level pages on the fixture origins, so a discussion
 * accidentally opened as a tab (instead of the side panel) fails the test.
 * @param extension - The launched extension context.
 */
function fixturePageCount(extension: ExtensionContext): number {
    return extension.context.pages().filter((page) => (
        page.url().startsWith(HN_ORIGIN) || page.url().startsWith(ARTICLE_ORIGIN)
    )).length;
}

test('article clicks open the discussion beside the article only while the opt-in setting is on', async () => {
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext();
        // The narrowed alias keeps the deferred expect.poll closures typed.
        const active = extension;
        await installArticleClickFixtures(active.context);

        // Off by default: nothing is registered and a story click is a plain
        // navigation with no discussion side effects.
        expect(await registeredScriptIds(active)).toEqual([]);

        const hnPage = await active.context.newPage();
        await hnPage.goto(`${HN_ORIGIN}/`);
        await hnPage.getByRole('link', { name: STORY_ONE.title }).click();
        await hnPage.waitForURL(`${ARTICLE_ORIGIN}${STORY_ONE.path}`);
        expect(await sidePanelSelection(active)).toBeUndefined();
        expect(fixturePageCount(active)).toBe(1);

        // Enabling the setting through the options switch registers the
        // Hacker News content script.
        const options = await openExtensionPage(active, 'options.html');
        const articleClickSwitch = options.getByRole('switch', {
            name: enMessages.article_click_open_label.message,
        });
        await articleClickSwitch.press('Space');
        await expect(articleClickSwitch).toBeChecked();
        expect(await registeredScriptIds(active)).toEqual([ARTICLE_CLICK_CONTENT_SCRIPT.ID]);

        // Registration reaches documents loaded from now on: a story click
        // navigates this tab to the article and selects the discussion for
        // the side panel without opening any tab.
        await hnPage.goto(`${HN_ORIGIN}/`);
        await hnPage.getByRole('link', { name: STORY_ONE.title }).click();
        await hnPage.waitForURL(`${ARTICLE_ORIGIN}${STORY_ONE.path}`);
        await expect.poll(async () => sidePanelSelection(active)).toBe(STORY_ONE.id);
        expect(fixturePageCount(active)).toBe(1);

        // A later click reuses the same panel selection instead of stacking
        // discussions anywhere.
        await hnPage.goto(`${HN_ORIGIN}/`);
        await hnPage.getByRole('link', { name: STORY_TWO.title }).click();
        await hnPage.waitForURL(`${ARTICLE_ORIGIN}${STORY_TWO.path}`);
        await expect.poll(async () => sidePanelSelection(active)).toBe(STORY_TWO.id);
        expect(fixturePageCount(active)).toBe(1);

        // Turning the setting off removes the registration and freshly loaded
        // pages stop reporting clicks entirely.
        await articleClickSwitch.press('Space');
        await expect(articleClickSwitch).not.toBeChecked();
        expect(await registeredScriptIds(active)).toEqual([]);

        await hnPage.goto(`${HN_ORIGIN}/`);
        await hnPage.getByRole('link', { name: STORY_ONE.title }).click();
        await hnPage.waitForURL(`${ARTICLE_ORIGIN}${STORY_ONE.path}`);
        // Bounded settle for the negative case: a wrongly sent message would
        // land within this window.
        await hnPage.waitForTimeout(500);
        expect(await sidePanelSelection(active)).toBe(STORY_TWO.id);
        expect(fixturePageCount(active)).toBe(1);

        await options.close();
        await hnPage.close();
    } finally {
        await extension?.dispose();
    }
});

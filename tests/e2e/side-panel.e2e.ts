import { expect, test } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { launchExtensionContext, openExtensionPage } from './extension-context';
import type { ExtensionContext } from './extension-context';

const ITEM_ID = '424242';
const FRAMING_RULE_ID = 1;

/**
 * Verifies the framing exception is scoped to a live panel and that the panel
 * frames the selected discussion. Hacker News itself is served from a route so
 * the assertion never depends on the live site.
 */
test('installs the framing exception only while the side panel is open', async () => {
    let extension: ExtensionContext | undefined;

    try {
        extension = await launchExtensionContext();
        const { context, worker } = extension;

        await context.route('https://news.ycombinator.com/**', async (route) => {
            await route.fulfill({
                contentType: 'text/html',
                headers: { 'x-frame-options': 'DENY' },
                body: '<!doctype html><title>Fixture discussion</title><main><h1>Fixture discussion</h1></main>',
            });
        });

        const rulesBefore = await worker.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
        expect(rulesBefore).toEqual([]);

        await worker.evaluate(async (itemId) => {
            await chrome.storage.session.set({
                side_panel_discussion: { kind: 'discussion', itemId },
            });
        }, ITEM_ID);

        const panel = await openExtensionPage(extension, 'side-panel.html');

        // The panel is chrome-free: the framing disclosure lives on the options
        // page, so nothing competes with the discussion for panel space.
        await expect(panel.getByText(enMessages.side_panel_notice.message)).toHaveCount(0);

        const frame = panel.locator('iframe.discussion-frame');
        await expect(frame).toHaveAttribute('src', `https://news.ycombinator.com/item?id=${ITEM_ID}`);

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

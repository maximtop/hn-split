import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { DIAGNOSTIC_EVENT } from '../../src/shared/diagnostic-events';
import { DIAGNOSTIC_REQUEST } from '../../src/shared/diagnostic-protocol';
import { DIAGNOSTIC_FORMAT_VERSION, DIAGNOSTIC_LEVEL, DIAGNOSTIC_SOURCE } from '../../src/shared/diagnostics';

import { launchExtensionContext, openExtensionPage } from './extension-context';

test('exports the session log as a local file and clears it from Options', async () => {
    const extension = await launchExtensionContext();
    try {
        const options = await openExtensionPage(extension, 'options.html');
        await options.evaluate(async ({ clear, append, event }) => {
            await chrome.runtime.sendMessage({ type: clear });
            await chrome.runtime.sendMessage({ type: append, event });
        }, {
            clear: DIAGNOSTIC_REQUEST.CLEAR,
            append: DIAGNOSTIC_REQUEST.APPEND,
            event: { level: DIAGNOSTIC_LEVEL.INFO, message: DIAGNOSTIC_EVENT.FRAMING_READY, details: {} },
        });
        await options.reload();
        await expect(options.getByRole('heading', { name: enMessages.diagnostics_title.message })).toBeVisible();
        const version = await options.evaluate(() => chrome.runtime.getManifest().version);
        const pagesBefore = extension.context.pages().length;
        const downloadPromise = options.waitForEvent('download');
        await options.getByRole('button', { name: enMessages.diagnostics_export.message }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^\d{8}_\d{6}_hn_split_v[\d.]+\.txt$/);
        const path = await download.path();
        expect(path).not.toBeNull();
        const records: unknown[] = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        expect(records[0]).toMatchObject({ formatVersion: DIAGNOSTIC_FORMAT_VERSION, extensionVersion: version });
        expect(records).toContainEqual(expect.objectContaining({
            message: DIAGNOSTIC_EVENT.FRAMING_READY, source: DIAGNOSTIC_SOURCE.OPTIONS, details: {},
        }));
        expect(extension.context.pages()).toHaveLength(pagesBefore);
        await options.getByRole('button', { name: enMessages.diagnostics_clear.message }).click();
        await expect(options.getByRole('status').filter({ hasText: enMessages.diagnostics_cleared.message })).toBeVisible();
        await options.reload();
        await expect(options.getByRole('status').filter({ hasText: enMessages.diagnostics_empty.message })).toBeVisible();
    } finally {
        await extension.context.close();
    }
});

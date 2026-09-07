/* eslint-disable */
// TEMPORARY diagnostic probe for the flaky a11y side panel test. Not committed.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import { HN_LOOKUP_STATUS } from '../../src/domain/hn';
import { sidePanelContentKey } from '../../src/shared/storage-keys';
import {
    installLookupFixtures,
    launchExtensionContext,
    openExtensionPage,
} from './extension-context';
import type { ExtensionContext } from './extension-context';

const FIXTURE_HITS = [
    { objectID: '515151', title: 'Primary fixture discussion', num_comments: 12, points: 30, created_at_i: 1_700_000_000 },
];

const t0 = Date.now();
const stamp = (): string => `+${String(Date.now() - t0).padStart(6, ' ')}ms`;

async function installWorkerProbe(extension: ExtensionContext): Promise<void> {
    await extension.worker.evaluate(() => {
        const g = globalThis as any;
        g.__probe = [];
        const push = (entry: Record<string, unknown>) => g.__probe.push({ t: Date.now(), ...entry });
        chrome.storage.session.onChanged.addListener((changes) => {
            push({ storage: JSON.stringify(changes) });
        });
        chrome.tabs.onActivated.addListener((info) => push({ activated: info }));
        chrome.tabs.onUpdated.addListener((tabId, change) => push({ updated: tabId, change }));
        chrome.tabs.onRemoved.addListener((tabId) => push({ removed: tabId }));
        chrome.tabs.onCreated.addListener((tab) => push({ created: tab.id, active: tab.active }));
        chrome.runtime.onConnect.addListener((port) => {
            push({ connect: port.name, sender: port.sender?.url });
            port.onMessage.addListener((m) => push({ portIn: JSON.stringify(m) }));
            const original = port.postMessage.bind(port);
            port.postMessage = ((m: unknown) => { push({ portOut: JSON.stringify(m) }); original(m); }) as any;
            port.onDisconnect.addListener(() => push({ disconnect: port.name }));
        });
    });
}

async function dumpWorkerProbe(extension: ExtensionContext, label: string): Promise<void> {
    const entries = await extension.worker.evaluate(() => (globalThis as any).__probe as Array<{ t: number }>);
    console.log(`=== worker probe (${label}) ===`);
    for (const entry of entries) {
        const { t, ...rest } = entry;
        console.log(`  +${String(t - t0).padStart(6, ' ')}ms ${JSON.stringify(rest)}`);
    }
}

async function openManualPanel(extension: ExtensionContext, colorScheme: 'light' | 'dark', log: string[]): Promise<Page> {
    const page = await openExtensionPage(extension, 'side-panel.html', {
        colorScheme,
        beforeNavigate: async (target) => {
            target.on('console', (message) => {
                log.push(`${stamp()} [panel ${colorScheme}] ${message.type()}: ${message.text()}`);
            });
        },
    });
    log.push(`${stamp()} [test] goto resolved (${colorScheme})`);
    await expect(page.getByRole('button', { name: enMessages.side_panel_check_this_tab.message })).toBeVisible();
    log.push(`${stamp()} [test] manual button visible (${colorScheme})`);
    return page;
}

async function publishRecoverablePanelError(extension: ExtensionContext, log: string[]): Promise<void> {
    const owner = await extension.worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) {
            throw new Error('Active fixture tab is unavailable');
        }
        return { tabId: tab.id, windowId: tab.windowId };
    });
    const key = sidePanelContentKey(owner.windowId);
    const written = await extension.worker.evaluate(async ({ contentKey, reason, tabId }) => {
        const stored = await chrome.storage.session.get(contentKey);
        const current = stored[contentKey] as { revision?: unknown } | undefined;
        const revision = typeof current?.revision === 'number'
            && Number.isSafeInteger(current.revision)
            ? current.revision + 1
            : 1;
        await chrome.storage.session.set({
            [contentKey]: {
                revision,
                content: { kind: 'unavailable', tabId, reason },
            },
        });
        return { revision, previous: JSON.stringify(current) };
    }, {
        contentKey: key,
        reason: HN_LOOKUP_STATUS.ERROR,
        tabId: owner.tabId,
    });
    log.push(`${stamp()} [test] published error owner=${JSON.stringify(owner)} ${JSON.stringify(written)}`);
}

test('probe: manual and recoverable-error states', async () => {
    const log: string[] = [];
    let extension: ExtensionContext | undefined;
    try {
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        log.push(`${stamp()} [test] worker ${extension.worker.url()}`);
        extension.context.on('serviceworker', (worker) => {
            log.push(`${stamp()} [ctx] NEW serviceworker ${worker.url()}`);
        });
        extension.context.on('console', (message) => {
            if (message.page() === null) {
                log.push(`${stamp()} [worker] ${message.type()}: ${message.text()}`);
            }
        });
        await installWorkerProbe(extension);
        await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });
        for (const colorScheme of ['light', 'dark'] as const) {
            const page = await openManualPanel(extension, colorScheme, log);
            await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
            log.push(`${stamp()} [test] scan done (${colorScheme})`);
            await publishRecoverablePanelError(extension, log);
            try {
                await expect(page.getByRole('button', {
                    name: enMessages.side_panel_retry.message,
                })).toBeVisible({ timeout: 4000 });
                log.push(`${stamp()} [test] retry visible (${colorScheme})`);
            } catch (error) {
                log.push(`${stamp()} [test] RETRY NOT VISIBLE (${colorScheme})`);
                const stored = await extension.worker.evaluate(async () => chrome.storage.session.get(null));
                log.push(`${stamp()} [test] storage now: ${JSON.stringify(stored)}`);
                log.push(`${stamp()} [test] service workers: ${extension.context.serviceWorkers().map((w) => w.url()).join(',')}`);
                console.log(log.join('\n'));
                await dumpWorkerProbe(extension, colorScheme);
                throw error;
            }
            await page.close();
            log.push(`${stamp()} [test] page closed (${colorScheme})`);
        }
        if (process.env.PROBE_VERBOSE) {
            console.log(log.join('\n'));
            await dumpWorkerProbe(extension, 'pass');
        }
    } finally {
        await extension?.dispose();
    }
});

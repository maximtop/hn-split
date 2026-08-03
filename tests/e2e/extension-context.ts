import { chromium } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const ARTICLE_ORIGIN = 'https://article.hn-split.example.com';

/**
 * Owns one launched persistent Chromium context with the built extension.
 */
export interface ExtensionContext {
    /**
     * The persistent browser context with the unpacked extension loaded.
     */
    context: BrowserContext;
    /**
     * The extension background service worker.
     */
    worker: Worker;
    /**
     * The extension identifier resolved from the service worker URL.
     */
    extensionId: string;
    /**
     * Closes the context and removes its temporary user-data directory.
     */
    dispose(): Promise<void>;
}

/**
 * One Algolia hit fixture; `url` is filled with the searched query so every
 * hit exactly matches the candidate identity.
 */
export interface AlgoliaHitFixture {
    objectID: string;
    title: string;
    num_comments: number;
    points: number;
    created_at_i: number;
}

/**
 * Launches a fresh persistent Chromium context with the extension from dist.
 * @param options - Optional browser UI language (Chromium honors --lang on
 * Linux CI; macOS ignores it and follows the system locale).
 */
export async function launchExtensionContext(
    options: { lang?: string } = {},
): Promise<ExtensionContext> {
    const extensionPath = resolve(import.meta.dirname, '../../dist');
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'hn-split-playwright-'));
    const args = [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
    ];
    if (options.lang !== undefined) {
        args.push(`--lang=${options.lang}`);
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args,
    });
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://'))
        ?? await context.waitForEvent(
            'serviceworker',
            (candidate) => candidate.url().startsWith('chrome-extension://'),
        );
    const extensionId = new URL(worker.url()).host;
    return {
        context,
        worker,
        extensionId,
        dispose: async () => {
            await context.close();
            await rm(userDataDir, { force: true, recursive: true });
        },
    };
}

/**
 * Serves deterministic article pages and Algolia responses. Each hit echoes
 * the searched query as its URL, so exact-identity verification always
 * succeeds against the fixture.
 * @param context - The extension browser context to install routes into.
 * @param options - The Algolia hits returned for every search.
 */
export async function installLookupFixtures(
    context: BrowserContext,
    options: { hits: AlgoliaHitFixture[] },
): Promise<void> {
    await context.route(`${ARTICLE_ORIGIN}/**`, async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Fixture article</title><main><h1>Fixture article</h1></main>',
        });
    });
    await context.route('https://hn.algolia.com/api/v1/search**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('query');
        await route.fulfill({
            contentType: 'application/json',
            json: { hits: options.hits.map((hit) => ({ ...hit, url: query })) },
        });
    });
}

/**
 * Patches the two popup browser calls that cannot run when popup.html is
 * opened as a regular tab: the popup itself would be the active tab, and
 * Chrome refuses to inject scripts into chrome-extension:// pages. Message
 * routing, the background worker, caching, fixtures, and rendering all stay
 * real.
 * @param page - The not-yet-navigated page that will load popup.html.
 * @param options - The article tab identifier and page URL to report.
 */
export async function shimPopupBrowserCalls(
    page: Page,
    options: { articleTabId: number; pageUrl: string },
): Promise<void> {
    await page.addInitScript(({ articleTabId, pageUrl }) => {
        chrome.tabs.query = (async () => [{ id: articleTabId }]) as unknown as typeof chrome.tabs.query;
        chrome.scripting.executeScript = (async () => [{
            result: { pageUrl, canonicalHref: pageUrl },
        }]) as unknown as typeof chrome.scripting.executeScript;
    }, options);
}

/**
 * Opens one extension page with deterministic media emulation applied before
 * navigation, so Mantine resolves the intended color scheme at first paint
 * and transitions never race assertions.
 * @param extension - The launched extension context.
 * @param file - The extension page to open.
 * @param options - Color scheme and an optional hook that runs before navigation.
 */
export async function openExtensionPage(
    extension: ExtensionContext,
    file: 'popup.html' | 'options.html',
    options: {
        colorScheme?: 'light' | 'dark';
        beforeNavigate?: (page: Page) => Promise<void>;
    } = {},
): Promise<Page> {
    const page = await extension.context.newPage();
    await page.emulateMedia({
        colorScheme: options.colorScheme ?? 'light',
        reducedMotion: 'reduce',
    });
    if (options.beforeNavigate !== undefined) {
        await options.beforeNavigate(page);
    }
    await page.goto(`chrome-extension://${extension.extensionId}/${file}`);
    return page;
}

import { chromium } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import {
    cp,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
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
 * Configures a persistent extension test context.
 */
export interface ExtensionLaunchOptions {
    /**
     * Selects one packaged Chrome catalog. Linux exercises Chrome's real
     * browser-process locale against the untouched build; other platforms use
     * a disposable localized extension because Chromium does not consistently
     * honor Unix process locale overrides there.
     */
    catalogLocale?: string;
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
 * Captures deterministic per-article lookup and discussion-frame requests.
 */
export interface PerArticleLookupCapture {
    /**
     * Records the exact Algolia request URLs observed by the fixture.
     */
    algoliaRequests: string[];
    /**
     * Records the exact Hacker News sub-frame request URLs observed by the fixture.
     */
    discussionFrameRequests: string[];
}

/**
 * Creates a disposable extension copy in which Chrome must resolve messages
 * from one requested packaged catalog.
 *
 * Non-Linux Chromium derives its browser-process locale from platform settings
 * rather than Playwright's `locale`, `--lang`, or Unix locale environment variables.
 * Making the requested catalog the sole default keeps
 * `chrome.i18n.getMessage` real for local cross-platform coverage.
 * @param sourceDirectory - The ordinary unpacked extension build to copy.
 * @param catalogLocale - The Chrome `_locales` code to select.
 */
async function createLocalizedExtensionCopy(
    sourceDirectory: string,
    catalogLocale: string,
): Promise<string> {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'hn-split-localized-extension-'));
    const extensionDirectory = resolve(temporaryDirectory, 'extension');
    try {
        await cp(sourceDirectory, extensionDirectory, { recursive: true });
        const localesDirectory = resolve(extensionDirectory, '_locales');
        const localeEntries = await readdir(localesDirectory, { withFileTypes: true });
        if (!localeEntries.some((entry) => entry.isDirectory() && entry.name === catalogLocale)) {
            throw new Error(`Packaged extension is missing the ${catalogLocale} catalog`);
        }
        await Promise.all(localeEntries
            .filter(({ name }) => name !== catalogLocale)
            .map(({ name }) => rm(resolve(localesDirectory, name), { force: true, recursive: true })));

        const manifestPath = resolve(extensionDirectory, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.default_locale = catalogLocale;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return extensionDirectory;
    } catch (error) {
        await rm(temporaryDirectory, { force: true, recursive: true });
        throw error;
    }
}

/**
 * Launches a fresh persistent Chromium context with the extension from dist.
 * @param options - Optional packaged catalog fixture configuration.
 */
export async function launchExtensionContext(
    options: ExtensionLaunchOptions = {},
): Promise<ExtensionContext> {
    const builtExtensionPath = resolve(import.meta.dirname, '../../dist');
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'hn-split-playwright-'));
    let localizedExtensionPath: string | null = null;
    try {
        localizedExtensionPath = options.catalogLocale === undefined || process.platform === 'linux'
            ? null
            : await createLocalizedExtensionCopy(builtExtensionPath, options.catalogLocale);
    } catch (error) {
        await rm(userDataDir, { force: true, recursive: true });
        throw error;
    }
    const extensionPath = localizedExtensionPath ?? builtExtensionPath;
    const chromeUiLanguage = options.catalogLocale?.replaceAll('_', '-');
    const args = [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
    ];
    // Linux Chromium reads its browser-process UI locale from the Unix locale
    // environment. Playwright separately defaults page renderers to en-US, so
    // the explicit context locale below keeps both processes on the same catalog.
    const browserEnvironment = options.catalogLocale !== undefined && process.platform === 'linux'
        ? {
                ...process.env,
                LANG: 'C.UTF-8',
                LANGUAGE: options.catalogLocale.replaceAll('-', '_'),
                LC_ALL: 'C.UTF-8',
            }
        : undefined;
    let context: BrowserContext;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chromium',
            headless: true,
            args,
            ...(chromeUiLanguage === undefined ? {} : { locale: chromeUiLanguage }),
            ...(browserEnvironment === undefined ? {} : { env: browserEnvironment }),
        });
    } catch (error) {
        await Promise.all([
            rm(userDataDir, { force: true, recursive: true }),
            ...(localizedExtensionPath === null
                ? []
                : [rm(resolve(localizedExtensionPath, '..'), { force: true, recursive: true })]),
        ]);
        throw error;
    }
    let worker: Worker;
    try {
        worker = context.serviceWorkers().find(
            (candidate) => candidate.url().startsWith('chrome-extension://'),
        ) ?? await context.waitForEvent(
            'serviceworker',
            (candidate) => candidate.url().startsWith('chrome-extension://'),
        );
    } catch (error) {
        try {
            await context.close();
        } catch {
            // Preserve the service-worker discovery failure reported below.
        }
        await Promise.allSettled([
            rm(userDataDir, { force: true, recursive: true }),
            ...(localizedExtensionPath === null
                ? []
                : [rm(resolve(localizedExtensionPath, '..'), { force: true, recursive: true })]),
        ]);
        throw error;
    }
    const extensionId = new URL(worker.url()).host;
    return {
        context,
        worker,
        extensionId,
        dispose: async () => {
            try {
                await context.close();
            } finally {
                await Promise.all([
                    rm(userDataDir, { force: true, recursive: true }),
                    ...(localizedExtensionPath === null
                        ? []
                        : [rm(resolve(localizedExtensionPath, '..'), { force: true, recursive: true })]),
                ]);
            }
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
 * Serves exact per-path lookup outcomes and captures every external surface
 * used by the side-panel synchronization flow.
 * @param context - The extension browser context to install routes into.
 * @param discussions - Article pathnames mapped to a discussion item or null.
 */
export async function installPerArticleLookupFixtures(
    context: BrowserContext,
    discussions: Readonly<Record<string, string | null>>,
): Promise<PerArticleLookupCapture> {
    const algoliaRequests: string[] = [];
    const discussionFrameRequests: string[] = [];
    await context.route(`${ARTICLE_ORIGIN}/**`, async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Fixture article</title><main><h1>Fixture article</h1></main>',
        });
    });
    await context.route('https://hn.algolia.com/api/v1/search**', async (route) => {
        const requestUrl = route.request().url();
        algoliaRequests.push(requestUrl);
        const query = new URL(requestUrl).searchParams.get('query');
        let pathname = '';
        if (query !== null) {
            try {
                pathname = new URL(query).pathname;
            } catch {
                pathname = '';
            }
        }
        const itemId = discussions[pathname] ?? null;
        await route.fulfill({
            contentType: 'application/json',
            json: {
                hits: itemId === null || query === null
                    ? []
                    : [{
                            objectID: itemId,
                            title: 'Fixture discussion',
                            url: query,
                            num_comments: 10,
                            points: 20,
                            created_at_i: 1,
                        }],
            },
        });
    });
    await context.route('https://news.ycombinator.com/item**', async (route) => {
        discussionFrameRequests.push(route.request().url());
        await route.fulfill({
            contentType: 'text/html',
            headers: { 'x-frame-options': 'DENY' },
            body: '<!doctype html><title>Fixture discussion</title><main style="height:4000px"><h1>Fixture discussion</h1></main>',
        });
    });
    return { algoliaRequests, discussionFrameRequests };
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
    file: 'popup.html' | 'options.html' | 'side-panel.html',
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

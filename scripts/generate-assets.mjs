import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

// Node 24 strips types natively, so the generator reuses the e2e fixture
// helpers instead of duplicating the Algolia and popup shims.
import { BASE_LOCALE, LOCALE_REGISTRY, SHIPPED_LOCALES } from '../src/shared/locales.ts';
import { installLookupFixtures, shimPopupBrowserCalls } from '../tests/e2e/extension-context.ts';

const ROOT = resolve(import.meta.dirname, '..');
const IDENTITY_DIR = resolve(ROOT, 'assets/identity');
const STORE_DIR = resolve(ROOT, 'assets/store');
const ICONS_DIR = resolve(ROOT, 'public/icons');

const ARTICLE_URL = 'https://article.hn-split.example.com/story';

const BRAND_FONT = 'system-ui, -apple-system, \'Segoe UI\', Roboto, sans-serif';

// `--locale <code>` renders the screenshots with that locale's captions (from
// assets/store-listings) and asks Chromium for that UI language. The base
// locale writes the committed assets; other locales write to build/ so the
// repository holds only the English imagery (docs/store-listing.md).
const localeFlagIndex = process.argv.indexOf('--locale');
const locale = localeFlagIndex === -1 ? BASE_LOCALE : process.argv[localeFlagIndex + 1];
if (!SHIPPED_LOCALES.includes(locale)) {
    throw new Error(`Unknown locale ${locale}; expected one of ${SHIPPED_LOCALES.join(', ')}.`);
}
const isBaseLocale = locale === BASE_LOCALE;
const localeEntry = LOCALE_REGISTRY.find(({ code }) => code === locale);
const screenshotDir = isBaseLocale ? STORE_DIR : resolve(ROOT, 'build/store-assets', locale);

/**
 * Reads one locale's message catalog.
 * @param code - Registry code whose catalog is read.
 */
async function readMessages(code) {
    return JSON.parse(await readFile(resolve(ROOT, `public/_locales/${code}/messages.json`), 'utf8'));
}

const listing = JSON.parse(await readFile(resolve(ROOT, `assets/store-listings/${locale}.json`), 'utf8'));
const messages = await readMessages(locale);
const baseMessages = isBaseLocale ? messages : await readMessages(BASE_LOCALE);

/**
 * Builds a substring accessible-name pattern accepting the localized label or
 * its English fallback, because platforms that ignore Chromium's `--lang`
 * switch render the extension UI in English. Substring semantics match
 * Playwright's string-name behavior: the popup button's accessible name also
 * carries the fixture story title and metrics.
 * @param localized - Label in the requested locale.
 * @param base - Label in the base locale.
 */
function labelPattern(localized, base) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?:${escape(localized)}|${escape(base)})`);
}

/**
 * Renders one SVG file inside a plain Chromium page and screenshots it at
 * exact pixel dimensions. `artWidth`/`artHeight` shrink the artwork inside
 * the canvas (used for the 128 store icon, which needs 96x96 artwork inside
 * 16px transparent padding per Chrome Web Store guidance).
 */
async function renderSvg(page, svgPath, { width, height, artWidth = width, artHeight = height, out, transparent = false }) {
    const svg = await readFile(svgPath, 'base64');
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><style>
        html, body { margin: 0; height: 100%; background: transparent; }
        body { display: grid; place-items: center; }
    </style><img width="${artWidth}" height="${artHeight}" src="data:image/svg+xml;base64,${svg}">`);
    await page.screenshot({ path: out, omitBackground: transparent });
    console.log(`wrote ${out}`);
}

/**
 * Composes one 1280x800 Chrome Web Store screenshot: brand background,
 * caption, and a real UI capture (base64 PNG taken at deviceScaleFactor 2,
 * displayed at half size so it stays crisp).
 */
async function renderStage(page, { heading, sub, capture, displayWidth, layout, dark = false, out }) {
    await page.setViewportSize({ width: 1280, height: 800 });
    const background = dark
        ? 'radial-gradient(120% 130% at 80% -10%, #3A2A1C 0%, #171B24 55%, #10141C 100%)'
        : 'radial-gradient(120% 130% at 80% -10%, #FFE1C7 0%, #F4F1EA 55%, #ECE7DC 100%)';
    const headingColor = dark ? '#F4F6F9' : '#232733';
    const subColor = dark ? '#A8B0BF' : '#5C5648';
    const row = layout === 'row';
    await page.setContent(`<!doctype html><style>
        html, body { margin: 0; height: 100%; }
        body {
            box-sizing: border-box;
            display: flex;
            flex-direction: ${row ? 'row' : 'column'};
            align-items: center;
            justify-content: ${row ? 'space-between' : 'flex-start'};
            gap: ${row ? '48px' : '28px'};
            padding: ${row ? '0 88px' : '56px 88px 0'};
            background: ${background};
            font-family: ${BRAND_FONT};
        }
        .caption { max-width: ${row ? '520px' : '1040px'}; }
        h1 { margin: 0 0 16px; font-size: 46px; line-height: 1.1; color: ${headingColor}; }
        p { margin: 0; font-size: 21px; line-height: 1.45; color: ${subColor}; }
        .shot {
            border-radius: 14px;
            box-shadow: 0 24px 64px rgba(16, 20, 28, ${dark ? '0.8' : '0.28'});
            overflow: hidden;
            flex: none;
            font-size: 0;
        }
        .shot img { width: ${displayWidth}px; height: auto; display: block; }
    </style><body dir="${localeEntry.rtl ? 'rtl' : 'ltr'}">
        <div class="caption"><h1>${heading}</h1><p>${sub}</p></div>
        <div class="shot"><img src="data:image/png;base64,${capture.toString('base64')}"></div>
    </body>`);
    await page.screenshot({ path: out });
    console.log(`wrote ${out}`);
}

/** Launches the built extension with a high-density viewport for captures. */
async function launchExtension() {
    const extensionPath = resolve(ROOT, 'dist');
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'hn-split-assets-'));
    // `--lang` (with the LANGUAGE fallback for Linux) asks Chromium to run the
    // extension UI in the requested locale; platforms that ignore the switch
    // fall back to English UI captures under localized captions.
    const chromeLanguage = locale.replace('_', '-');
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        deviceScaleFactor: 2,
        viewport: { width: 380, height: 720 },
        env: { ...process.env, LANGUAGE: chromeLanguage },
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            `--lang=${chromeLanguage}`,
        ],
    });
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith('chrome-extension://'))
        ?? await context.waitForEvent('serviceworker', (candidate) => candidate.url().startsWith('chrome-extension://'));
    const extensionId = new URL(worker.url()).host;
    return {
        context,
        extensionId,
        dispose: async () => {
            await context.close();
            await rm(userDataDir, { force: true, recursive: true });
        },
    };
}

/** Captures the real popup body rendered from fixture lookup data. */
async function capturePopup(extension, { colorScheme }) {
    const page = await extension.context.newPage();
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await shimPopupBrowserCalls(page, { articleTabId: 7, pageUrl: ARTICLE_URL });
    await page.goto(`chrome-extension://${extension.extensionId}/popup.html`);
    await page.getByRole('button', {
        name: labelPattern(messages.open_primary_discussion.message, baseMessages.open_primary_discussion.message),
    }).first().waitFor();
    if (!isBaseLocale && await page.getByRole('button', { name: messages.open_primary_discussion.message }).count() === 0) {
        console.warn(`the platform ignored --lang=${locale}; the UI capture stays English under ${locale} captions`);
    }
    const capture = await page.locator('body').screenshot();
    await page.close();
    return capture;
}

/** Captures the real options page in its default (privacy-first) state. */
async function captureOptions(extension) {
    const page = await extension.context.newPage();
    await page.setViewportSize({ width: 1160, height: 640 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto(`chrome-extension://${extension.extensionId}/options.html`);
    await page.getByRole('heading', {
        name: labelPattern(messages.options_heading.message, baseMessages.options_heading.message),
    }).first().waitFor();
    const capture = await page.screenshot();
    await page.close();
    return capture;
}

await mkdir(screenshotDir, { recursive: true });
await mkdir(ICONS_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const svgPage = await browser.newPage();

// Icons and promo tiles carry no text, so only the base-locale run renders
// them; the stores reuse one set across every listing language.
if (isBaseLocale) {
    const logo = resolve(IDENTITY_DIR, 'logo-mark.svg');
    for (const size of [16, 32, 48]) {
        await renderSvg(svgPage, logo, {
            width: size,
            height: size,
            out: resolve(ICONS_DIR, `icon-${size}.png`),
            transparent: true,
        });
    }
    // Store icon: 96x96 artwork centered inside 16px transparent padding.
    await renderSvg(svgPage, logo, {
        width: 128,
        height: 128,
        artWidth: 96,
        artHeight: 96,
        out: resolve(ICONS_DIR, 'icon-128.png'),
        transparent: true,
    });
    await renderSvg(svgPage, resolve(IDENTITY_DIR, 'promo-small.svg'), {
        width: 440,
        height: 280,
        out: resolve(STORE_DIR, 'small-promo-440x280.png'),
    });
    await renderSvg(svgPage, resolve(IDENTITY_DIR, 'promo-marquee.svg'), {
        width: 1400,
        height: 560,
        out: resolve(STORE_DIR, 'marquee-1400x560.png'),
    });
} else {
    console.log(`locale ${locale}: icons and promo tiles are locale-independent, rendering screenshots only`);
}

// Screenshots capture the real built extension, so build first.
console.log('building the extension for screenshot capture…');
await promisify(execFile)('pnpm', ['build'], { cwd: ROOT });

const extension = await launchExtension();
try {
    await installLookupFixtures(extension.context, {
        hits: [
            {
                objectID: '424242',
                title: 'A quieter way to read the web',
                num_comments: 128,
                points: 342,
                created_at_i: 1_760_000_000,
            },
            {
                objectID: '424243',
                title: 'Reading long articles without losing the thread',
                num_comments: 47,
                points: 156,
                created_at_i: 1_758_000_000,
            },
        ],
    });

    const popupLight = await capturePopup(extension, { colorScheme: 'light' });
    const popupDark = await capturePopup(extension, { colorScheme: 'dark' });
    const options = await captureOptions(extension);

    // Captions come from the locale's listing file, the same source the store
    // dashboards use, so screenshots and listing captions cannot diverge.
    const [discussionCaption, privateCaption, darkCaption] = listing.captions;
    await renderStage(svgPage, {
        heading: discussionCaption.heading,
        sub: discussionCaption.sub,
        capture: popupLight,
        displayWidth: 380,
        layout: 'row',
        out: resolve(screenshotDir, 'screenshot-1-discussion-1280x800.png'),
    });
    await renderStage(svgPage, {
        heading: privateCaption.heading,
        sub: privateCaption.sub,
        capture: options,
        displayWidth: 928,
        layout: 'column',
        out: resolve(screenshotDir, 'screenshot-2-private-defaults-1280x800.png'),
    });
    await renderStage(svgPage, {
        heading: darkCaption.heading,
        sub: darkCaption.sub,
        capture: popupDark,
        displayWidth: 380,
        layout: 'row',
        dark: true,
        out: resolve(screenshotDir, 'screenshot-3-dark-1280x800.png'),
    });
} finally {
    await extension.dispose();
}

await browser.close();
console.log('done');

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

// Node 24 strips types natively, so the generator reuses the e2e fixture
// helpers instead of duplicating the Algolia and popup shims.
import { installLookupFixtures, shimPopupBrowserCalls } from '../tests/e2e/extension-context.ts';

const ROOT = resolve(import.meta.dirname, '..');
const IDENTITY_DIR = resolve(ROOT, 'assets/identity');
const STORE_DIR = resolve(ROOT, 'assets/store');
const ICONS_DIR = resolve(ROOT, 'public/icons');

const ARTICLE_URL = 'https://article.hn-split.example.com/story';

const BRAND_FONT = 'system-ui, -apple-system, \'Segoe UI\', Roboto, sans-serif';

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
    </style><body>
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
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        deviceScaleFactor: 2,
        viewport: { width: 380, height: 720 },
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
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
    await page.getByRole('button', { name: 'Open discussion' }).waitFor();
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
    await page.getByRole('heading', { name: 'Availability indicator' }).waitFor();
    const capture = await page.screenshot();
    await page.close();
    return capture;
}

await mkdir(STORE_DIR, { recursive: true });
await mkdir(ICONS_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const svgPage = await browser.newPage();

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

    await renderStage(svgPage, {
        heading: 'From article to discussion in one click',
        sub: 'See the exact Hacker News thread for the page you are reading, with comment and point counts.',
        capture: popupLight,
        displayWidth: 380,
        layout: 'row',
        out: resolve(STORE_DIR, 'screenshot-1-discussion-1280x800.png'),
    });
    await renderStage(svgPage, {
        heading: 'Private by default',
        sub: 'Automatic availability badges stay off until you enable them. No telemetry, no accounts, no page reading.',
        capture: options,
        displayWidth: 928,
        layout: 'column',
        out: resolve(STORE_DIR, 'screenshot-2-private-defaults-1280x800.png'),
    });
    await renderStage(svgPage, {
        heading: 'At home in light and dark',
        sub: 'The popup follows your browser color scheme.',
        capture: popupDark,
        displayWidth: 380,
        layout: 'row',
        dark: true,
        out: resolve(STORE_DIR, 'screenshot-3-dark-1280x800.png'),
    });
} finally {
    await extension.dispose();
}

await browser.close();
console.log('done');

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    ARTICLE_ORIGIN,
    installLookupFixtures,
    launchExtensionContext,
    openExtensionPage,
    shimPopupBrowserCalls,
} from './extension-context';
import type { AlgoliaHitFixture, ExtensionContext } from './extension-context';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);
// Verified false positives only; every entry must carry a justification comment.
const ALLOWLISTED_RULE_IDS = new Set<string>([]);

const ARTICLE_URL = `${ARTICLE_ORIGIN}/a11y-article`;
const ARTICLE_TAB_ID = 1;

const FIXTURE_HITS: AlgoliaHitFixture[] = [
    {
        objectID: '515151',
        title: 'Primary fixture discussion',
        num_comments: 12,
        points: 30,
        created_at_i: 1_700_000_000,
    },
    {
        objectID: '515152',
        title: 'Alternative fixture discussion',
        num_comments: 3,
        points: 8,
        created_at_i: 1_700_000_100,
    },
];

const EN_BUTTON_NAMES = {
    primary: /Open discussion/,
    alternative: /Open alternative/,
} as const;

const RU_BUTTON_NAMES = {
    primary: /Открыть обсуждение/,
    alternative: /Открыть другое/,
} as const;

async function scanForBlockingViolations(page: Page, label: string): Promise<void> {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations.filter(
        (violation) => BLOCKING_IMPACTS.has(violation.impact ?? '')
            && !ALLOWLISTED_RULE_IDS.has(violation.id),
    );
    const advisory = results.violations.filter((violation) => !blocking.includes(violation));
    if (advisory.length > 0) {
        console.log(
            `[a11y:${label}] advisory findings: ${advisory
                .map(({ id, impact }) => `${id} (${impact ?? 'unknown'})`)
                .join(', ')}`,
        );
    }
    expect(
        blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.map(({ target, html }) => ({ target, html })),
        })),
        `axe ${label}`,
    ).toEqual([]);
}

async function openFoundPopup(
    extension: ExtensionContext,
    colorScheme: 'light' | 'dark',
    names: { primary: RegExp; alternative: RegExp } = EN_BUTTON_NAMES,
): Promise<Page> {
    const page = await openExtensionPage(extension, 'popup.html', {
        colorScheme,
        beforeNavigate: async (target) => {
            await shimPopupBrowserCalls(target, {
                articleTabId: ARTICLE_TAB_ID,
                pageUrl: ARTICLE_URL,
            });
        },
    });
    await expect(page.getByRole('button', { name: names.primary })).toBeVisible();
    await expect(page.getByRole('button', { name: names.alternative })).toBeVisible();
    return page;
}

async function expectVisibleFocusIndicator(page: Page): Promise<void> {
    const hasVisibleIndicator = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches(':focus-visible')) {
            return false;
        }
        const style = getComputedStyle(active);
        const hasOutline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
        return hasOutline || style.boxShadow !== 'none';
    });
    expect(hasVisibleIndicator, 'focused element must show a visible indicator').toBe(true);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
    const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector('main');
        return {
            documentOverflow: root.scrollWidth - root.clientWidth,
            mainOverflow: main === null ? 0 : main.scrollWidth - main.clientWidth,
        };
    });
    expect(overflow.documentOverflow, `document overflow on ${label}`).toBeLessThanOrEqual(0);
    expect(overflow.mainOverflow, `main overflow on ${label}`).toBeLessThanOrEqual(0);
}

test.describe('extension accessibility (en)', () => {
    let extension: ExtensionContext;

    test.beforeAll(async () => {
        extension = await launchExtensionContext();
        await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });
    });

    test.afterAll(async () => {
        await extension.dispose();
    });

    test('options page has no blocking axe violations in light and dark schemes', async () => {
        for (const colorScheme of ['light', 'dark'] as const) {
            const page = await openExtensionPage(extension, 'options.html', { colorScheme });
            await expect(page.getByRole('switch', { name: 'Automatically check article URLs' }))
                .toBeVisible();
            await scanForBlockingViolations(page, `options ${colorScheme}`);
            await page.close();
        }
    });

    test('popup found state has no blocking axe violations in light and dark schemes', async () => {
        for (const colorScheme of ['light', 'dark'] as const) {
            const page = await openFoundPopup(extension, colorScheme);
            await scanForBlockingViolations(page, `popup ${colorScheme}`);
            await page.close();
        }
    });

    test('popup is keyboard traversable with a visible focus indicator', async () => {
        const page = await openFoundPopup(extension, 'light');

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: EN_BUTTON_NAMES.primary })).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: EN_BUTTON_NAMES.alternative })).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Availability settings' })).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.close();
    });

    test('options switch is reachable from the keyboard', async () => {
        const page = await openExtensionPage(extension, 'options.html', { colorScheme: 'light' });
        const automaticSwitch = page.getByRole('switch', {
            name: 'Automatically check article URLs',
        });
        await expect(automaticSwitch).toBeVisible();

        await page.keyboard.press('Tab');
        await expect(automaticSwitch).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.close();
    });
});

test.describe('extension accessibility (ru)', () => {
    test('russian locale stamps the document language and fits both layouts', async () => {
        const extension = await launchExtensionContext({ lang: 'ru' });
        try {
            const uiLanguage: string = await extension.worker.evaluate(() => chrome.i18n.getUILanguage());
            test.skip(
                !uiLanguage.toLowerCase().startsWith('ru'),
                `Chromium ignored --lang=ru (UI language "${uiLanguage}", typical on macOS); enforced on Linux CI`,
            );
            await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });

            const options = await openExtensionPage(extension, 'options.html', { colorScheme: 'light' });
            await expect(options.getByRole('switch', { name: 'Автоматически проверять адреса статей' }))
                .toBeVisible();
            expect(await options.evaluate(() => document.documentElement.lang)).toBe('ru');
            await expectNoHorizontalOverflow(options, 'options ru');
            await scanForBlockingViolations(options, 'options ru light');
            await options.close();

            const popup = await openFoundPopup(extension, 'light', RU_BUTTON_NAMES);
            expect(await popup.evaluate(() => document.documentElement.lang)).toBe('ru');
            await expectNoHorizontalOverflow(popup, 'popup ru');
            await popup.close();
        } finally {
            await extension.dispose();
        }
    });
});

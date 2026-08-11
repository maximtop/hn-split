import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import arMessages from '../../public/_locales/ar/messages.json' with { type: 'json' };
import enMessages from '../../public/_locales/en/messages.json' with { type: 'json' };
import nbMessages from '../../public/_locales/nb/messages.json' with { type: 'json' };
import ruMessages from '../../public/_locales/ru/messages.json' with { type: 'json' };
import zhCnMessages from '../../public/_locales/zh_CN/messages.json' with { type: 'json' };
import { HN_LOOKUP_STATUS } from '../../src/domain/hn';
import { sidePanelContentKey } from '../../src/shared/storage-keys';
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
    primary: new RegExp(ruMessages.open_primary_discussion.message),
    alternative: new RegExp(ruMessages.open_alternative.message),
} as const;

const REPRESENTATIVE_LOCALIZED_LAYOUTS = [
    {
        bidiDirection: 'ltr',
        catalogLocale: 'nb',
        chromeUiLocale: 'nb',
        direction: 'ltr',
        documentLanguage: 'nb',
        label: 'nb (Norwegian Bokmål)',
        optionsSwitchName: nbMessages.automatic_badge_label.message,
        sidePanelCheckName: nbMessages.side_panel_check_this_tab.message,
        popupButtonNames: {
            primary: new RegExp(nbMessages.open_primary_discussion.message),
            alternative: new RegExp(nbMessages.open_alternative.message),
        },
        uiLanguage: 'nb',
    },
    {
        bidiDirection: 'ltr',
        catalogLocale: 'ru',
        chromeUiLocale: 'ru',
        direction: 'ltr',
        documentLanguage: 'ru',
        label: 'ru',
        optionsSwitchName: ruMessages.automatic_badge_label.message,
        sidePanelCheckName: ruMessages.side_panel_check_this_tab.message,
        popupButtonNames: RU_BUTTON_NAMES,
        uiLanguage: 'ru',
    },
    {
        bidiDirection: 'rtl',
        catalogLocale: 'ar',
        chromeUiLocale: 'ar',
        direction: 'rtl',
        documentLanguage: 'ar',
        label: 'ar RTL',
        optionsSwitchName: arMessages.automatic_badge_label.message,
        sidePanelCheckName: arMessages.side_panel_check_this_tab.message,
        popupButtonNames: {
            primary: new RegExp(arMessages.open_primary_discussion.message),
            alternative: new RegExp(arMessages.open_alternative.message),
        },
        uiLanguage: 'ar',
    },
    {
        bidiDirection: 'ltr',
        catalogLocale: 'zh_CN',
        chromeUiLocale: 'zh_CN',
        direction: 'ltr',
        documentLanguage: 'zh-CN',
        label: 'zh-CN CJK',
        optionsSwitchName: zhCnMessages.automatic_badge_label.message,
        sidePanelCheckName: zhCnMessages.side_panel_check_this_tab.message,
        popupButtonNames: {
            primary: new RegExp(zhCnMessages.open_primary_discussion.message),
            alternative: new RegExp(zhCnMessages.open_alternative.message),
        },
        uiLanguage: 'zh-CN',
    },
] as const;

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

/**
 * Launches one isolated English extension context with deterministic lookup fixtures.
 */
async function launchEnglishFixture(): Promise<ExtensionContext> {
    const extension = await launchExtensionContext({ catalogLocale: 'en' });
    try {
        expect(await extension.worker.evaluate(
            () => chrome.i18n.getMessage('automatic_badge_label'),
        )).toBe(enMessages.automatic_badge_label.message);
        await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });
        return extension;
    } catch (error) {
        await extension.dispose();
        throw error;
    }
}

/**
 * Opens the panel and waits for its framed manual-required state.
 * @param extension - The launched extension context.
 * @param colorScheme - The emulated browser color scheme.
 * @param checkName - The locale-owned one-shot button name.
 */
async function openManualPanel(
    extension: ExtensionContext,
    colorScheme: 'light' | 'dark',
    checkName = enMessages.side_panel_check_this_tab.message,
): Promise<Page> {
    const page = await openExtensionPage(extension, 'side-panel.html', { colorScheme });
    await expect(page.getByRole('button', { name: checkName })).toBeVisible();
    return page;
}

/**
 * Publishes one strict recoverable-error projection for the currently active
 * fixture tab after the panel has completed its initial READY handshake.
 * @param extension - The launched extension context.
 */
async function publishRecoverablePanelError(extension: ExtensionContext): Promise<void> {
    const owner = await extension.worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) {
            throw new Error('Active fixture tab is unavailable');
        }
        return { tabId: tab.id, windowId: tab.windowId };
    });
    const key = sidePanelContentKey(owner.windowId);
    await extension.worker.evaluate(async ({ contentKey, reason, tabId }) => {
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
    }, {
        contentKey: key,
        reason: HN_LOOKUP_STATUS.ERROR,
        tabId: owner.tabId,
    });
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
        extension = await launchExtensionContext({ catalogLocale: 'en' });
        expect(await extension.worker.evaluate(
            () => chrome.i18n.getMessage('automatic_badge_label'),
        )).toBe(enMessages.automatic_badge_label.message);
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
        await expect(page.getByRole('button', { name: 'Open in side panel' })).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', {
            name: enMessages.availability_settings.message,
        })).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.close();
    });

    test('options switches are reachable from the keyboard', async () => {
        const page = await openExtensionPage(extension, 'options.html', { colorScheme: 'light' });
        const automaticSwitch = page.getByRole('switch', {
            name: 'Automatically check article URLs',
        });
        await expect(automaticSwitch).toBeVisible();

        await page.keyboard.press('Tab');
        await expect(automaticSwitch).toBeFocused();
        await expectVisibleFocusIndicator(page);

        const followSwitch = page.getByRole('switch', {
            name: enMessages.side_panel_follow_label.message,
        });
        await page.keyboard.press('Tab');
        await expect(followSwitch).toBeFocused();
        await expectVisibleFocusIndicator(page);

        const articleClickSwitch = page.getByRole('switch', {
            name: enMessages.article_click_open_label.message,
        });
        await page.keyboard.press('Tab');
        await expect(articleClickSwitch).toBeFocused();
        await expectVisibleFocusIndicator(page);

        await page.close();
    });
});

test.describe('side panel accessibility (en)', () => {
    test('manual and recoverable-error states pass axe in light and dark schemes', async () => {
        let extension: ExtensionContext | undefined;
        try {
            extension = await launchEnglishFixture();
            for (const colorScheme of ['light', 'dark'] as const) {
                const page = await openManualPanel(extension, colorScheme);
                await scanForBlockingViolations(page, `side panel manual ${colorScheme}`);
                await publishRecoverablePanelError(extension);
                await expect(page.getByRole('button', {
                    name: enMessages.side_panel_retry.message,
                })).toBeVisible();
                await scanForBlockingViolations(page, `side panel error ${colorScheme}`);
                await page.close();
            }
        } finally {
            await extension?.dispose();
        }
    });

    test('manual choices and retry are keyboard reachable in document order', async () => {
        let extension: ExtensionContext | undefined;
        try {
            extension = await launchEnglishFixture();
            const page = await openManualPanel(extension, 'light');
            const check = page.getByRole('button', {
                name: enMessages.side_panel_check_this_tab.message,
            });
            const follow = page.getByRole('button', {
                name: enMessages.side_panel_follow_tabs_automatically.message,
            });

            await page.keyboard.press('Tab');
            await expect(check).toBeFocused();
            await expectVisibleFocusIndicator(page);
            await page.keyboard.press('Tab');
            await expect(follow).toBeFocused();
            await expectVisibleFocusIndicator(page);

            await publishRecoverablePanelError(extension);
            const retry = page.getByRole('button', {
                name: enMessages.side_panel_retry.message,
            });
            await expect(retry).toBeVisible();
            await page.keyboard.press('Tab');
            await expect(retry).toBeFocused();
            await expectVisibleFocusIndicator(page);
        } finally {
            await extension?.dispose();
        }
    });
});

for (const locale of REPRESENTATIVE_LOCALIZED_LAYOUTS) {
    test.describe(`extension accessibility (${locale.label})`, () => {
        test('locale metadata is correct and options and popup fit the viewport', async () => {
            const extension = await launchExtensionContext({ catalogLocale: locale.catalogLocale });
            try {
                const workerLocale = await extension.worker.evaluate(() => ({
                    bidiDirection: chrome.i18n.getMessage('@@bidi_dir'),
                    catalogMessage: chrome.i18n.getMessage('automatic_badge_label'),
                    uiLocale: chrome.i18n.getMessage('@@ui_locale'),
                    uiLanguage: chrome.i18n.getUILanguage(),
                }));
                expect(workerLocale.catalogMessage).toBe(locale.optionsSwitchName);
                if (process.platform === 'linux') {
                    expect(workerLocale).toEqual({
                        bidiDirection: locale.bidiDirection,
                        catalogMessage: locale.optionsSwitchName,
                        uiLanguage: locale.uiLanguage,
                        uiLocale: locale.chromeUiLocale,
                    });
                }
                await installLookupFixtures(extension.context, { hits: FIXTURE_HITS });

                const options = await openExtensionPage(extension, 'options.html', { colorScheme: 'light' });
                await expect(options.getByRole('switch', { name: locale.optionsSwitchName })).toBeVisible();
                expect(await options.evaluate(() => ({
                    direction: document.documentElement.dir,
                    language: document.documentElement.lang,
                    uiLanguage: chrome.i18n.getUILanguage(),
                }))).toEqual({
                    direction: locale.direction,
                    language: locale.documentLanguage,
                    uiLanguage: locale.uiLanguage,
                });
                await expectNoHorizontalOverflow(options, `options ${locale.label}`);
                await scanForBlockingViolations(options, `options ${locale.label} light`);
                await options.close();

                const popup = await openFoundPopup(extension, 'light', locale.popupButtonNames);
                expect(await popup.evaluate(() => ({
                    direction: document.documentElement.dir,
                    language: document.documentElement.lang,
                }))).toEqual({
                    direction: locale.direction,
                    language: locale.documentLanguage,
                });
                await expectNoHorizontalOverflow(popup, `popup ${locale.label}`);
                await popup.close();

                if (locale.catalogLocale === 'ar' || locale.catalogLocale === 'zh_CN') {
                    const panel = await openManualPanel(
                        extension,
                        'light',
                        locale.sidePanelCheckName,
                    );
                    await panel.setViewportSize({ width: 360, height: 800 });
                    await expect(panel.getByRole('button', {
                        name: locale.sidePanelCheckName,
                    })).toBeVisible();
                    await expectNoHorizontalOverflow(panel, `side panel ${locale.label}`);
                    await scanForBlockingViolations(panel, `side panel ${locale.label} light`);
                    await panel.close();
                }
            } finally {
                await extension.dispose();
            }
        });
    });
}

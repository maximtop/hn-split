import { EXTENSION_BRAND } from '../../src/shared/brand.ts';
import { LOCALE_REGISTRY } from '../../src/shared/locales.ts';

/**
 * The four submission targets whose listing localization this module models
 * (see docs/store-listing.md for the per-store requirement matrices).
 */
export const STORE_IDS = ['chrome', 'edge', 'amo', 'appStore'] as const;

/**
 * One store submission target.
 */
export type StoreId = (typeof STORE_IDS)[number];

/**
 * Manifest `description` length ceiling enforced by Chrome in every locale.
 * Chrome and Edge surface this string as the store summary / short
 * description, so the budget applies to `extension_description` in every
 * catalog, not only English.
 */
export const MANIFEST_DESCRIPTION_LIMIT = 132;

/**
 * AMO summary field ceiling; the summary reuses `extension_description`, so
 * the manifest budget above already keeps every locale inside this one.
 */
export const AMO_SUMMARY_LIMIT = 250;

/**
 * Edge Partner Center description floor, required per package language.
 */
export const EDGE_DESCRIPTION_MIN = 250;

/**
 * Edge Partner Center description ceiling.
 */
export const EDGE_DESCRIPTION_MAX = 10_000;

/**
 * Maximum number of Edge search terms per language.
 */
export const EDGE_SEARCH_TERM_MAX_COUNT = 7;

/**
 * Maximum length of one Edge search term.
 */
export const EDGE_SEARCH_TERM_MAX_LENGTH = 30;

/**
 * Maximum total word count across all Edge search terms of one language.
 */
export const EDGE_SEARCH_TERMS_MAX_WORDS = 21;

/**
 * App Store keyword string ceiling (comma-separated, counted together).
 */
export const APP_STORE_KEYWORDS_LIMIT = 100;

/**
 * App Store description ceiling; the strictest description budget across the
 * four stores, so it bounds the shared master translation even though the
 * Safari submission re-cuts the text.
 */
export const APP_STORE_DESCRIPTION_LIMIT = 4000;

/**
 * App Store "What's New" ceiling applied to per-version release notes.
 */
export const APP_STORE_WHATS_NEW_LIMIT = 4000;

/**
 * Layout budget for one screenshot caption heading. The 1280x800 caption
 * stage wraps headings at 46px; longer strings overflow the panel, so the
 * budget is a rendering constraint rather than a store rule.
 */
export const CAPTION_HEADING_LIMIT = 80;

/**
 * Layout budget for one screenshot caption subline, mirroring the caption
 * stage constraint above.
 */
export const CAPTION_SUB_LIMIT = 200;

/**
 * Number of captioned store screenshots the asset generator renders.
 */
export const SCREENSHOT_CAPTION_COUNT = 3;

/**
 * One screenshot caption pair rendered into store imagery by
 * `pnpm assets:generate`: the large heading and the supporting subline.
 */
export interface ListingCaption {
    /**
     * Large heading rendered beside the UI capture.
     */
    heading: string;

    /**
     * Supporting sentence rendered under the heading.
     */
    sub: string;
}

/**
 * Translatable description of the master listing, kept structured so every
 * locale provably carries the same claims: one intro, the same bullet list,
 * and the unofficial disclaimer. `assembleDescription` renders the store
 * field from these parts.
 */
export interface ListingDescription {
    /**
     * Opening paragraph naming the product and the single-click behavior.
     */
    intro: string;

    /**
     * Feature bullets; every locale must keep the English bullet count so no
     * reviewed claim is dropped or invented in translation.
     */
    bullets: string[];

    /**
     * Closing unofficial-disclaimer paragraph; must keep the Y Combinator and
     * Hacker News proper nouns untranslated.
     */
    disclaimer: string;
}

/**
 * One locale's translated store listing content, stored as
 * `assets/store-listings/<code>.json` and validated against the English base
 * by `scripts/validate-store-listings.mjs`.
 */
export interface ListingContent {
    /**
     * Registry code of the locale, matching the file name.
     */
    locale: string;

    /**
     * Indicates a native-speaker-reviewed translation; machine-translated
     * catalogs stay `false` until reviewed (docs/locales.md records the
     * review policy).
     */
    reviewed: boolean;

    /**
     * Structured translation of the master description.
     */
    description: ListingDescription;

    /**
     * Release notes per version tag; every locale must carry the same
     * version keys as English.
     */
    releaseNotes: Record<string, string>;

    /**
     * Screenshot caption pairs consumed by the asset generator, one per
     * store screenshot.
     */
    captions: ListingCaption[];

    /**
     * Localized Edge search terms (also the vocabulary source for other
     * store keyword fields).
     */
    searchTerms: string[];

    /**
     * Localized App Store keyword string, comma-separated.
     */
    appStoreKeywords: string;
}

/**
 * One store's locale inventory: how every registry code reaches that store.
 */
export interface StoreDescriptor {
    /**
     * Human-readable store name for reports and documentation.
     */
    name: string;

    /**
     * ISO date the locale inventory and limits were last verified.
     */
    checked: string;

    /**
     * Authority the inventory was verified against.
     */
    source: string;

    /**
     * Maps every registry code to the store's own locale code, or `null`
     * when the store cannot represent the locale at all.
     */
    locales: Readonly<Record<string, string | null>>;

    /**
     * Store locale whose listing serves audiences of unsupported registry
     * codes; `null` when every registry code maps.
     */
    unsupportedFallback: string | null;
}

/**
 * Builds a complete registry-code map, applying explicit renames and marking
 * explicitly unsupported codes with `null` so no locale is ever dropped
 * implicitly.
 * @param renames - Registry codes whose store code differs from the registry code.
 * @param unsupported - Registry codes the store cannot represent.
 */
function buildLocaleMap(
    renames: Record<string, string>,
    unsupported: readonly string[] = [],
): Record<string, string | null> {
    return Object.fromEntries(LOCALE_REGISTRY.map(({ code }) => {
        if (unsupported.includes(code)) {
            return [code, null];
        }
        return [code, renames[code] ?? code];
    }));
}

/**
 * The four store locale inventories. Every map covers all 40 prepared
 * registry codes, including locales not yet promoted into release packages,
 * so future fallback behavior stays explicit and machine-checked.
 */
export const STORE_CATALOG: Readonly<Record<StoreId, StoreDescriptor>> = {
    chrome: {
        name: 'Chrome Web Store',
        checked: '2026-08-06',
        source: 'developer.chrome.com/docs/extensions/reference/api/i18n (56 locale codes) and docs/webstore/cws-dashboard-listing',
        // The dashboard offers one listing per packaged `_locales` directory.
        // Every prepared registry code is eligible for future promotion, so
        // the capability map is the identity even though only reviewed codes
        // currently ship.
        locales: buildLocaleMap({}),
        unsupportedFallback: null,
    },
    edge: {
        name: 'Microsoft Edge Add-ons',
        checked: '2026-08-06',
        source: 'learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension (languages detected from package `_locales`; description required per language)',
        locales: buildLocaleMap({}),
        unsupportedFallback: null,
    },
    amo: {
        name: 'Firefox Add-ons (AMO)',
        checked: '2026-08-06',
        source: 'github.com/mozilla/addons-server src/olympia/core/languages.py (AMO_LANGUAGES)',
        // AMO names ten of our codes differently; `fil` maps to AMO's
        // Tagalog slot (`tl`), the standardized register of the same
        // language, rather than falling back to English.
        locales: buildLocaleMap({
            en: 'en-US',
            es: 'es-ES',
            es_419: 'es-MX',
            fil: 'tl',
            no: 'nb-NO',
            pt_BR: 'pt-BR',
            pt_PT: 'pt-PT',
            sv: 'sv-SE',
            zh_CN: 'zh-CN',
            zh_TW: 'zh-TW',
        }),
        unsupportedFallback: null,
    },
    appStore: {
        name: 'App Store (Safari)',
        checked: '2026-08-06',
        source: 'developer.apple.com/help/app-store-connect/reference/app-store-localizations (50 localizations)',
        // Bulgarian, Persian, Filipino, and Serbian have no App Store
        // localization; those audiences see the primary en-US product page.
        locales: buildLocaleMap({
            en: 'en-US',
            es: 'es-ES',
            es_419: 'es-MX',
            pt_BR: 'pt-BR',
            pt_PT: 'pt-PT',
            zh_CN: 'zh-Hans',
            zh_TW: 'zh-Hant',
        }, ['bg', 'fa', 'fil', 'sr']),
        unsupportedFallback: 'en-US',
    },
};

/**
 * Renders the store description field from its structured parts: intro
 * paragraph, dashed bullet list, and disclaimer paragraph separated by blank
 * lines — the exact shape of the master description in docs/store-listing.md.
 * @param description - Structured description of one locale.
 */
export function assembleDescription(description: ListingDescription): string {
    return [
        description.intro,
        description.bullets.map((bullet) => `- ${bullet}`).join('\n'),
        description.disclaimer,
    ].join('\n\n');
}

/**
 * Counts whitespace-separated words across all search terms, the unit Edge
 * budgets (21 words total across at most 7 terms).
 * @param searchTerms - Localized search terms of one locale.
 */
export function countSearchTermWords(searchTerms: readonly string[]): number {
    return searchTerms.reduce((total, term) => total + term.split(/\s+/u).filter(Boolean).length, 0);
}

/**
 * Validates one locale's listing content against the English base and every
 * store budget, returning human-readable problems (empty when valid). Store
 * budgets are applied uniformly to keep the files interchangeable; issues
 * name the store whose rule produced them.
 * @param content - Parsed listing content of the locale under validation.
 * @param base - Parsed English base listing the structure is compared against.
 */
export function collectListingIssues(content: ListingContent, base: ListingContent): string[] {
    const issues: string[] = [];
    const { description, releaseNotes, captions, searchTerms, appStoreKeywords } = content;

    if (typeof content.reviewed !== 'boolean') {
        issues.push('reviewed must be a boolean');
    }

    const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

    if (!nonEmpty(description?.intro) || !nonEmpty(description?.disclaimer)) {
        issues.push('description.intro and description.disclaimer must be non-empty strings');
        return issues;
    }
    if (!Array.isArray(description.bullets) || !description.bullets.every(nonEmpty)) {
        issues.push('description.bullets must be non-empty strings');
        return issues;
    }
    if (description.bullets.length !== base.description.bullets.length) {
        issues.push(`description.bullets must keep the ${base.description.bullets.length} reviewed English bullets, found ${description.bullets.length}`);
    }
    if (!description.intro.includes(EXTENSION_BRAND)) {
        issues.push(`description.intro must keep the untranslated brand string "${EXTENSION_BRAND}"`);
    }
    for (const requiredName of ['Y Combinator', 'Hacker News']) {
        if (!description.disclaimer.includes(requiredName)) {
            issues.push(`description.disclaimer must keep the untranslated proper noun "${requiredName}"`);
        }
    }

    const assembled = assembleDescription(description);
    if (assembled.length < EDGE_DESCRIPTION_MIN) {
        issues.push(`assembled description is ${assembled.length} characters, under the Edge minimum of ${EDGE_DESCRIPTION_MIN}`);
    }
    if (assembled.length > APP_STORE_DESCRIPTION_LIMIT) {
        issues.push(`assembled description is ${assembled.length} characters, over the App Store limit of ${APP_STORE_DESCRIPTION_LIMIT}`);
    }
    if (assembled.length > EDGE_DESCRIPTION_MAX) {
        issues.push(`assembled description is ${assembled.length} characters, over the Edge limit of ${EDGE_DESCRIPTION_MAX}`);
    }

    const baseVersions = Object.keys(base.releaseNotes).sort();
    const versions = Object.keys(releaseNotes ?? {}).sort();
    if (JSON.stringify(versions) !== JSON.stringify(baseVersions)) {
        issues.push(`releaseNotes must cover versions [${baseVersions.join(', ')}], found [${versions.join(', ')}]`);
    }
    for (const [version, notes] of Object.entries(releaseNotes ?? {})) {
        if (!nonEmpty(notes)) {
            issues.push(`releaseNotes ${version} must be a non-empty string`);
        } else if (notes.length > APP_STORE_WHATS_NEW_LIMIT) {
            issues.push(`releaseNotes ${version} is ${notes.length} characters, over the App Store What's New limit of ${APP_STORE_WHATS_NEW_LIMIT}`);
        }
    }

    if (!Array.isArray(captions) || captions.length !== SCREENSHOT_CAPTION_COUNT) {
        issues.push(`captions must contain exactly ${SCREENSHOT_CAPTION_COUNT} heading/sub pairs`);
    } else {
        captions.forEach((caption, index) => {
            if (!nonEmpty(caption?.heading) || !nonEmpty(caption?.sub)) {
                issues.push(`captions[${index}] must have non-empty heading and sub`);
                return;
            }
            if (caption.heading.length > CAPTION_HEADING_LIMIT) {
                issues.push(`captions[${index}].heading is ${caption.heading.length} characters, over the layout budget of ${CAPTION_HEADING_LIMIT}`);
            }
            if (caption.sub.length > CAPTION_SUB_LIMIT) {
                issues.push(`captions[${index}].sub is ${caption.sub.length} characters, over the layout budget of ${CAPTION_SUB_LIMIT}`);
            }
        });
    }

    if (!Array.isArray(searchTerms) || searchTerms.length === 0 || !searchTerms.every(nonEmpty)) {
        issues.push('searchTerms must be a non-empty list of non-empty strings');
    } else {
        if (searchTerms.length > EDGE_SEARCH_TERM_MAX_COUNT) {
            issues.push(`searchTerms has ${searchTerms.length} terms, over the Edge limit of ${EDGE_SEARCH_TERM_MAX_COUNT}`);
        }
        for (const term of searchTerms) {
            if (term.length > EDGE_SEARCH_TERM_MAX_LENGTH) {
                issues.push(`search term "${term}" is ${term.length} characters, over the Edge limit of ${EDGE_SEARCH_TERM_MAX_LENGTH}`);
            }
        }
        const words = countSearchTermWords(searchTerms);
        if (words > EDGE_SEARCH_TERMS_MAX_WORDS) {
            issues.push(`searchTerms total ${words} words, over the Edge limit of ${EDGE_SEARCH_TERMS_MAX_WORDS}`);
        }
    }

    if (!nonEmpty(appStoreKeywords)) {
        issues.push('appStoreKeywords must be a non-empty string');
    } else if (appStoreKeywords.length > APP_STORE_KEYWORDS_LIMIT) {
        issues.push(`appStoreKeywords is ${appStoreKeywords.length} characters, over the App Store limit of ${APP_STORE_KEYWORDS_LIMIT}`);
    }

    return issues;
}

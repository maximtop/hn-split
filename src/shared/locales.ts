import type { Locale } from '@adguard/translate';

/**
 * Describes one priority locale in the single source of truth consumed by the
 * validation script, the runtime locale resolver, and documentation.
 */
export interface LocaleEntry {
    /**
     * Contains the Chrome `_locales` directory code (Chrome-supported form).
     */
    code: string;
    /**
     * Contains the `@adguard/translate` locale used for runtime translation
     * and plural validation; diverges from `code` where the library uses
     * lowercase region codes or lacks the locale (`es_419` maps to `es`).
     */
    adguardCode: Locale;
    /**
     * Contains the English language name for documentation and tooling output.
     */
    englishName: string;
    /**
     * Indicates whether the locale requires right-to-left layout.
     */
    rtl: boolean;
}

/**
 * Contains the base locale that every catalog is validated against.
 */
export const BASE_LOCALE: Locale = 'en';

/**
 * Names the 40 priority locales selected for HN Split. Every code is directly
 * supported by Chrome's `_locales` mechanism; see docs/locales.md for the
 * validation record, fallback notes, and selection rationale.
 */
export const LOCALE_REGISTRY: readonly LocaleEntry[] = [
    { code: 'ar', adguardCode: 'ar', englishName: 'Arabic', rtl: true },
    { code: 'bg', adguardCode: 'bg', englishName: 'Bulgarian', rtl: false },
    { code: 'bn', adguardCode: 'bn', englishName: 'Bengali', rtl: false },
    { code: 'ca', adguardCode: 'ca', englishName: 'Catalan', rtl: false },
    { code: 'cs', adguardCode: 'cs', englishName: 'Czech', rtl: false },
    { code: 'da', adguardCode: 'da', englishName: 'Danish', rtl: false },
    { code: 'de', adguardCode: 'de', englishName: 'German', rtl: false },
    { code: 'el', adguardCode: 'el', englishName: 'Greek', rtl: false },
    { code: 'en', adguardCode: 'en', englishName: 'English', rtl: false },
    { code: 'es', adguardCode: 'es', englishName: 'Spanish', rtl: false },
    { code: 'es_419', adguardCode: 'es', englishName: 'Latin American Spanish', rtl: false },
    { code: 'fa', adguardCode: 'fa', englishName: 'Persian', rtl: true },
    { code: 'fi', adguardCode: 'fi', englishName: 'Finnish', rtl: false },
    { code: 'fil', adguardCode: 'fil', englishName: 'Filipino', rtl: false },
    { code: 'fr', adguardCode: 'fr', englishName: 'French', rtl: false },
    { code: 'he', adguardCode: 'he', englishName: 'Hebrew', rtl: true },
    { code: 'hi', adguardCode: 'hi', englishName: 'Hindi', rtl: false },
    { code: 'hr', adguardCode: 'hr', englishName: 'Croatian', rtl: false },
    { code: 'hu', adguardCode: 'hu', englishName: 'Hungarian', rtl: false },
    { code: 'id', adguardCode: 'id', englishName: 'Indonesian', rtl: false },
    { code: 'it', adguardCode: 'it', englishName: 'Italian', rtl: false },
    { code: 'ja', adguardCode: 'ja', englishName: 'Japanese', rtl: false },
    { code: 'ko', adguardCode: 'ko', englishName: 'Korean', rtl: false },
    { code: 'ms', adguardCode: 'ms', englishName: 'Malay', rtl: false },
    { code: 'nl', adguardCode: 'nl', englishName: 'Dutch', rtl: false },
    { code: 'no', adguardCode: 'no', englishName: 'Norwegian', rtl: false },
    { code: 'pl', adguardCode: 'pl', englishName: 'Polish', rtl: false },
    { code: 'pt_BR', adguardCode: 'pt_br', englishName: 'Brazilian Portuguese', rtl: false },
    { code: 'pt_PT', adguardCode: 'pt_pt', englishName: 'European Portuguese', rtl: false },
    { code: 'ro', adguardCode: 'ro', englishName: 'Romanian', rtl: false },
    { code: 'ru', adguardCode: 'ru', englishName: 'Russian', rtl: false },
    { code: 'sk', adguardCode: 'sk', englishName: 'Slovak', rtl: false },
    { code: 'sr', adguardCode: 'sr', englishName: 'Serbian', rtl: false },
    { code: 'sv', adguardCode: 'sv', englishName: 'Swedish', rtl: false },
    { code: 'th', adguardCode: 'th', englishName: 'Thai', rtl: false },
    { code: 'tr', adguardCode: 'tr', englishName: 'Turkish', rtl: false },
    { code: 'uk', adguardCode: 'uk', englishName: 'Ukrainian', rtl: false },
    { code: 'vi', adguardCode: 'vi', englishName: 'Vietnamese', rtl: false },
    { code: 'zh_CN', adguardCode: 'zh_cn', englishName: 'Simplified Chinese', rtl: false },
    { code: 'zh_TW', adguardCode: 'zh_tw', englishName: 'Traditional Chinese', rtl: false },
];

/**
 * Names the registry codes whose catalogs actually ship in `public/_locales`.
 * Every priority locale ships a catalog; the locale validation script asserts
 * this list matches the directories, so it cannot drift from reality.
 */
export const SHIPPED_LOCALES: readonly string[] = LOCALE_REGISTRY.map(({ code }) => code);

/**
 * Resolves a normalized browser UI language to a shipped registry entry.
 * @param uiLanguage - The lowercase, underscore-normalized UI language.
 */
export function resolveShippedLocale(uiLanguage: string): LocaleEntry | undefined {
    const shipped = LOCALE_REGISTRY.filter((entry) => SHIPPED_LOCALES.includes(entry.code));
    const language = uiLanguage.split('_')[0] ?? uiLanguage;
    return shipped.find((entry) => entry.code.toLowerCase() === uiLanguage)
        ?? shipped.find((entry) => entry.code.toLowerCase().split('_')[0] === language);
}

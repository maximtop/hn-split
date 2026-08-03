import { translate } from '@adguard/translate';
import type { I18nInterface, Locale } from '@adguard/translate';

import baseMessages from '../../public/_locales/en/messages.json';
import { BASE_LOCALE, resolveShippedLocale } from './locales';
import type { LocaleEntry } from './locales';

export type MessageKey = keyof typeof baseMessages;

/**
 * Returns the bundled English message used when the Chrome i18n API is unavailable.
 * @param key - The locale catalog key to resolve.
 */
function getBaseMessage(key: string): string {
    const entry = baseMessages[key as MessageKey];
    return entry?.message ?? key;
}

/**
 * Resolves the browser UI language to a shipped registry entry when possible.
 */
function resolveUiEntry(): LocaleEntry | undefined {
    if (typeof chrome === 'undefined' || chrome.i18n?.getUILanguage === undefined) {
        return undefined;
    }
    const normalized = chrome.i18n.getUILanguage().toLowerCase().replace('-', '_');
    return resolveShippedLocale(normalized);
}

/**
 * Maps the Chrome UI language onto a shipped registry locale for the translator.
 */
export function getUiLocale(): Locale {
    return resolveUiEntry()?.adguardCode ?? BASE_LOCALE;
}

/**
 * Stamps the resolved locale's BCP-47 language tag and text direction onto the
 * document, so assistive technology and RTL locales render correctly.
 */
export function applyDocumentLocale(): void {
    const entry = resolveUiEntry();
    document.documentElement.lang = (entry?.code ?? BASE_LOCALE).replace('_', '-');
    document.documentElement.dir = entry?.rtl === true ? 'rtl' : 'ltr';
}

const i18n: I18nInterface = {
    getMessage(key): string {
        if (typeof chrome === 'undefined' || chrome.i18n?.getMessage === undefined) {
            return getBaseMessage(key);
        }
        return chrome.i18n.getMessage(key) || getBaseMessage(key);
    },
    getUILanguage: getUiLocale,
    getBaseMessage,
    getBaseUILanguage: () => BASE_LOCALE,
};

const translator = translate.createTranslator(i18n);

/**
 * Translates a user-facing message with optional placeholder values.
 * @param key - The locale catalog key to translate.
 * @param values - The optional placeholder values for the translated message.
 */
export function t(key: MessageKey, values: Record<string, unknown> = {}): string {
    return translator.getMessage(key, values);
}

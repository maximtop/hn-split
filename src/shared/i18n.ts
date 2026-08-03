import { translate } from '@adguard/translate';
import type { I18nInterface, Locale } from '@adguard/translate';

import baseMessages from '../../public/_locales/en/messages.json';
import { BASE_LOCALE, resolveShippedLocale } from './locales';

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
 * Maps the Chrome UI language onto a shipped registry locale, exposed so
 * extension pages can stamp the resolved language on the document.
 */
export function getUiLocale(): Locale {
    if (typeof chrome === 'undefined' || chrome.i18n?.getUILanguage === undefined) {
        return BASE_LOCALE;
    }
    const normalized = chrome.i18n.getUILanguage().toLowerCase().replace('-', '_');
    return resolveShippedLocale(normalized)?.adguardCode ?? BASE_LOCALE;
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

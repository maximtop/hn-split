import { translate } from '@adguard/translate';
import type { I18nInterface, Locale } from '@adguard/translate';

import baseMessages from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof baseMessages;

const BASE_LOCALE: Locale = 'en';

/**
 * Returns the bundled English message used when the Chrome i18n API is unavailable.
 * @param key - The locale catalog key to resolve.
 */
function getBaseMessage(key: string): string {
    const entry = baseMessages[key as MessageKey];
    return entry?.message ?? key;
}

/**
 * Maps Chrome locale identifiers to locales supported by AdGuard Translate.
 */
function getUiLocale(): Locale {
    if (typeof chrome === 'undefined' || chrome.i18n?.getUILanguage === undefined) {
        return BASE_LOCALE;
    }
    const locale = chrome.i18n.getUILanguage().toLowerCase().replace('-', '_');
    if (locale === 'ru' || locale.startsWith('ru_')) {
        return 'ru';
    }
    return BASE_LOCALE;
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

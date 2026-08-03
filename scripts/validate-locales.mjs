import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validator } from '@adguard/translate';

// Node 24 strips types natively, so the plain-node script can consume the
// same registry as the application code — one source of truth.
import { BASE_LOCALE, LOCALE_REGISTRY, SHIPPED_LOCALES } from '../src/shared/locales.ts';

const EXPECTED_LOCALE_COUNT = 40;

const registryCodes = LOCALE_REGISTRY.map(({ code }) => code);
if (registryCodes.length !== EXPECTED_LOCALE_COUNT
    || new Set(registryCodes).size !== EXPECTED_LOCALE_COUNT) {
    throw new Error(`The locale registry must contain exactly ${EXPECTED_LOCALE_COUNT} unique locales.`);
}

const localesDirectory = resolve(import.meta.dirname, '../public/_locales');
const localeNames = (await readdir(localesDirectory)).sort();
const shipped = [...SHIPPED_LOCALES].sort();
if (JSON.stringify(localeNames) !== JSON.stringify(shipped)) {
    throw new Error(
        `public/_locales directories [${localeNames.join(', ')}] must match `
        + `SHIPPED_LOCALES [${shipped.join(', ')}] in src/shared/locales.ts.`,
    );
}

const baseMessages = JSON.parse(
    await readFile(resolve(localesDirectory, BASE_LOCALE, 'messages.json'), 'utf8'),
);

for (const locale of localeNames) {
    const entry = LOCALE_REGISTRY.find(({ code }) => code === locale);
    if (entry === undefined) {
        throw new Error(`Locale directory ${locale} is not part of the priority locale registry.`);
    }
    const messages = JSON.parse(
        await readFile(resolve(localesDirectory, locale, 'messages.json'), 'utf8'),
    );
    const baseKeys = Object.keys(baseMessages).sort();
    const translatedKeys = Object.keys(messages).sort();
    if (JSON.stringify(baseKeys) !== JSON.stringify(translatedKeys)) {
        throw new Error(`Locale ${locale} does not contain the same message keys as ${BASE_LOCALE}.`);
    }
    for (const key of baseKeys) {
        const baseMessage = baseMessages[key]?.message;
        const translatedMessage = messages[key]?.message;
        if (typeof baseMessage !== 'string' || typeof translatedMessage !== 'string') {
            throw new TypeError(`Locale ${locale} has an invalid ${key} message.`);
        }
        // The library locale (not the directory name) selects plural rules, so
        // future plural strings validate correctly for es_419 and the
        // uppercase-region directories.
        if (!validator.isTranslationValid(baseMessage, translatedMessage, entry.adguardCode)) {
            throw new Error(`Locale ${locale} has an invalid ${key} translation structure.`);
        }
    }
}

console.log(`Validated ${localeNames.length} locales against ${BASE_LOCALE}.`);

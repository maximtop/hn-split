import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validator } from '@adguard/translate';

// Node 24 strips types natively, so the plain-node script can consume the
// same registry as the application code — one source of truth.
import { BASE_LOCALE, LOCALE_REGISTRY, SHIPPED_LOCALES } from '../src/shared/locales.ts';
import { MANIFEST_DESCRIPTION_LIMIT } from './lib/store-listings.ts';

const EXPECTED_LOCALE_COUNT = 40;

const registryCodes = LOCALE_REGISTRY.map(({ code }) => code);
if (registryCodes.length !== EXPECTED_LOCALE_COUNT
    || new Set(registryCodes).size !== EXPECTED_LOCALE_COUNT) {
    throw new Error(`The locale registry must contain exactly ${EXPECTED_LOCALE_COUNT} unique locales.`);
}

const shipped = [...SHIPPED_LOCALES].sort();
if (new Set(shipped).size !== shipped.length) {
    throw new Error('SHIPPED_LOCALES must contain unique locale codes.');
}
if (!SHIPPED_LOCALES.includes(BASE_LOCALE)) {
    throw new Error(`SHIPPED_LOCALES must include the base locale ${BASE_LOCALE}.`);
}
const unknownShippedLocales = shipped.filter((code) => !registryCodes.includes(code));
if (unknownShippedLocales.length > 0) {
    throw new Error(
        `SHIPPED_LOCALES contains codes outside the locale registry: ${unknownShippedLocales.join(', ')}.`,
    );
}

const localesDirectory = resolve(import.meta.dirname, '../public/_locales');
const localeNames = (await readdir(localesDirectory)).sort();
const registered = [...registryCodes].sort();
if (JSON.stringify(localeNames) !== JSON.stringify(registered)) {
    throw new Error(
        `public/_locales directories [${localeNames.join(', ')}] must match `
        + `LOCALE_REGISTRY [${registered.join(', ')}] in src/shared/locales.ts.`,
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
    // Chrome and Edge read the store summary from the manifest description,
    // so the manifest budget applies to every locale, not only English.
    const description = messages.extension_description.message;
    if (description.length > MANIFEST_DESCRIPTION_LIMIT) {
        throw new Error(
            `Locale ${locale} extension_description is ${description.length} characters; `
            + `the manifest limit is ${MANIFEST_DESCRIPTION_LIMIT}.`,
        );
    }
    // The product name is a brand string and is never translated
    // (docs/store-listing.md, Identity).
    if (messages.extension_name.message !== baseMessages.extension_name.message) {
        throw new Error(`Locale ${locale} must not translate extension_name.`);
    }
}

console.log(
    `Validated ${localeNames.length} registered locales against ${BASE_LOCALE}; `
    + `shipping ${shipped.join(', ')}.`,
);

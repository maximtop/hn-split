import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validator } from '@adguard/translate';

const localesDirectory = resolve(import.meta.dirname, '../public/_locales');
const baseLocale = 'en';
const baseMessages = JSON.parse(
    await readFile(resolve(localesDirectory, baseLocale, 'messages.json'), 'utf8'),
);
const localeNames = await readdir(localesDirectory);

for (const locale of localeNames) {
    const messages = JSON.parse(
        await readFile(resolve(localesDirectory, locale, 'messages.json'), 'utf8'),
    );
    const baseKeys = Object.keys(baseMessages).sort();
    const translatedKeys = Object.keys(messages).sort();
    if (JSON.stringify(baseKeys) !== JSON.stringify(translatedKeys)) {
        throw new Error(`Locale ${locale} does not contain the same message keys as ${baseLocale}.`);
    }
    for (const key of baseKeys) {
        const baseMessage = baseMessages[key]?.message;
        const translatedMessage = messages[key]?.message;
        if (typeof baseMessage !== 'string' || typeof translatedMessage !== 'string') {
            throw new TypeError(`Locale ${locale} has an invalid ${key} message.`);
        }
        if (!validator.isTranslationValid(baseMessage, translatedMessage, locale)) {
            throw new Error(`Locale ${locale} has an invalid ${key} translation structure.`);
        }
    }
}

console.log(`Validated ${localeNames.length} locales against ${baseLocale}.`);

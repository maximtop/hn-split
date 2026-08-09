import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { EXTENSION_BRAND } from '../src/shared/brand.ts';
import { SHIPPED_LOCALES } from '../src/shared/locales.ts';
import { assembleDescription, STORE_CATALOG, STORE_IDS } from './lib/store-listings.ts';

const [storeId, locale] = process.argv.slice(2);
if (!STORE_IDS.includes(storeId) || !SHIPPED_LOCALES.includes(locale)) {
    console.error(`Usage: pnpm store:render <${STORE_IDS.join('|')}> <locale>`);
    console.error(`Locales: ${SHIPPED_LOCALES.join(', ')}`);
    process.exit(1);
}

const store = STORE_CATALOG[storeId];
const storeLocale = store.locales[locale];
if (storeLocale === null) {
    console.log(`${store.name} has no ${locale} listing; that audience sees the ${store.unsupportedFallback} listing (checked ${store.checked}).`);
    process.exit(0);
}

const root = resolve(import.meta.dirname, '..');
const listing = JSON.parse(await readFile(resolve(root, `assets/store-listings/${locale}.json`), 'utf8'));
const messages = JSON.parse(await readFile(resolve(root, `public/_locales/${locale}/messages.json`), 'utf8'));

/**
 * Prints one labelled listing field with a blank separator line.
 * @param label - Field name as shown in the store dashboard.
 * @param value - Paste-ready field value.
 */
function printField(label, value) {
    console.log(`## ${label}\n\n${value}\n`);
}

console.log(`# ${store.name} — ${storeLocale} (from ${locale}${listing.reviewed ? '' : ', release review pending'})\n`);
printField('Name (from manifest; read-only)', EXTENSION_BRAND);
printField('Summary / short description (from manifest; read-only)', messages.extension_description.message);
printField(storeId === 'chrome' ? 'Detailed description (paste into dashboard)' : 'Description', assembleDescription(listing.description));
if (storeId !== 'chrome') {
    for (const [version, notes] of Object.entries(listing.releaseNotes)) {
        printField(`Release notes ${version}`, notes);
    }
}
if (storeId === 'edge') {
    printField('Search terms', listing.searchTerms.join('; '));
}
if (storeId === 'appStore') {
    printField('Keywords', listing.appStoreKeywords);
}

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Node 24 strips types natively, so the plain-node script consumes the same
// registry and store catalog as the application code and tests.
import { BASE_LOCALE, LOCALE_REGISTRY, SHIPPED_LOCALES } from '../src/shared/locales.ts';
import { collectListingIssues, STORE_CATALOG, STORE_IDS } from './lib/store-listings.ts';

const listingsDirectory = resolve(import.meta.dirname, '../assets/store-listings');
const fileLocales = (await readdir(listingsDirectory))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/u, ''))
    .sort();
const shipped = [...SHIPPED_LOCALES].sort();
const prepared = LOCALE_REGISTRY.map(({ code }) => code).sort();
if (JSON.stringify(fileLocales) !== JSON.stringify(prepared)) {
    throw new Error(
        `assets/store-listings files [${fileLocales.join(', ')}] must match `
        + `LOCALE_REGISTRY [${prepared.join(', ')}] in src/shared/locales.ts.`,
    );
}

/**
 * Reads and parses one locale's listing file.
 * @param locale - Registry code whose listing file is read.
 */
async function readListing(locale) {
    return JSON.parse(await readFile(resolve(listingsDirectory, `${locale}.json`), 'utf8'));
}

const base = await readListing(BASE_LOCALE);
const problems = [];
for (const locale of fileLocales) {
    const content = await readListing(locale);
    if (content.locale !== locale) {
        problems.push(`${locale}: locale field "${content.locale}" must match the file name`);
    }
    if (SHIPPED_LOCALES.includes(locale) && content.reviewed !== true) {
        problems.push(`${locale}: a shipped store listing must be native-speaker reviewed`);
    }
    problems.push(...collectListingIssues(content, base).map((issue) => `${locale}: ${issue}`));
}

// Every store map remains ready for every prepared locale: either mapped to a
// store locale code or to null backed by a declared fallback listing.
const storeSummaries = [];
for (const storeId of STORE_IDS) {
    const store = STORE_CATALOG[storeId];
    const mappedCodes = Object.keys(store.locales).sort();
    if (JSON.stringify(mappedCodes) !== JSON.stringify(prepared)) {
        problems.push(`${storeId}: locale map must cover exactly the prepared locales`);
        continue;
    }
    const unsupported = prepared.filter((code) => store.locales[code] === null);
    if (unsupported.length > 0 && store.unsupportedFallback === null) {
        problems.push(`${storeId}: unsupported locales [${unsupported.join(', ')}] need an explicit fallback listing`);
    }
    const supportedCount = prepared.length - unsupported.length;
    storeSummaries.push(unsupported.length === 0
        ? `${storeId} ${supportedCount}/${prepared.length}`
        : `${storeId} ${supportedCount}/${prepared.length} (${unsupported.join(', ')} → ${store.unsupportedFallback})`);
}

if (problems.length > 0) {
    console.error(problems.join('\n'));
    throw new Error(`${problems.length} store listing problem(s) found.`);
}

const reviewedCount = (await Promise.all(fileLocales.map(readListing)))
    .filter(({ reviewed }) => reviewed === true).length;
console.log(
    `Validated ${fileLocales.length} prepared store listings against ${BASE_LOCALE}; `
    + `${storeSummaries.join(', ')}; ${reviewedCount} reviewed; shipping ${shipped.join(', ')}.`,
);

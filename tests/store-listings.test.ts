import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    assembleDescription,
    collectListingIssues,
    countSearchTermWords,
    type ListingContent,
    STORE_CATALOG,
    STORE_IDS,
} from '../scripts/lib/store-listings';
import { LOCALE_REGISTRY, SHIPPED_LOCALES } from '../src/shared/locales';

const listingsDirectory = resolve(__dirname, '../assets/store-listings');

/**
 * Reads one locale's listing file from the repository.
 * @param locale - Registry code whose listing file is read.
 */
function readListing(locale: string): ListingContent {
    return JSON.parse(readFileSync(resolve(listingsDirectory, `${locale}.json`), 'utf8')) as ListingContent;
}

const base = readListing('en');

describe('store locale catalog', () => {
    it('keeps every registered locale mapped for each store', () => {
        const registered = LOCALE_REGISTRY.map(({ code }) => code).sort();
        for (const storeId of STORE_IDS) {
            expect(Object.keys(STORE_CATALOG[storeId].locales).sort()).toEqual(registered);
        }
    });

    it('maps every Chrome and Edge package locale without fallbacks', () => {
        for (const { code } of LOCALE_REGISTRY) {
            expect(STORE_CATALOG.edge.locales[code]).toBe(code);
            expect(STORE_CATALOG.chrome.locales[code]).toBe(code === 'nb' ? 'no' : code);
        }
    });

    it('renames exactly the documented codes on AMO with no fallbacks', () => {
        const amo = STORE_CATALOG.amo.locales;
        expect(amo.en).toBe('en-US');
        expect(amo.es).toBe('es-ES');
        expect(amo.es_419).toBe('es-MX');
        expect(amo.fil).toBe('tl');
        expect(amo.nb).toBe('nb-NO');
        expect(amo.sv).toBe('sv-SE');
        expect(amo.pt_BR).toBe('pt-BR');
        expect(amo.zh_CN).toBe('zh-CN');
        expect(Object.values(amo).every((storeLocale) => storeLocale !== null)).toBe(true);
        expect(STORE_CATALOG.amo.unsupportedFallback).toBeNull();
    });

    it('falls back to en-US for exactly the four App-Store-unsupported locales', () => {
        const appStore = STORE_CATALOG.appStore.locales;
        const unsupported = Object.entries(appStore)
            .filter(([, storeLocale]) => storeLocale === null)
            .map(([code]) => code)
            .sort();
        expect(unsupported).toEqual(['bg', 'fa', 'fil', 'sr']);
        expect(STORE_CATALOG.appStore.unsupportedFallback).toBe('en-US');
        expect(appStore.zh_CN).toBe('zh-Hans');
        expect(appStore.zh_TW).toBe('zh-Hant');
        expect(appStore.nb).toBe('no');
    });

    it('records a check date and source for every store', () => {
        for (const storeId of STORE_IDS) {
            expect(STORE_CATALOG[storeId].checked).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
            expect(STORE_CATALOG[storeId].source.length).toBeGreaterThan(0);
        }
    });
});

describe('listing files', () => {
    it('exist for exactly the registered locales', () => {
        const files = readdirSync(listingsDirectory)
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.replace(/\.json$/u, ''))
            .sort();
        expect(files).toEqual(LOCALE_REGISTRY.map(({ code }) => code).sort());
    });

    it.each(LOCALE_REGISTRY.map(({ code }) => code))('validate %s against the English base', (locale) => {
        const content = readListing(locale);
        expect(content.locale).toBe(locale);
        expect(collectListingIssues(content, base)).toEqual([]);
    });

    it('ships exactly the listings that passed the release review gate', () => {
        const reviewed = LOCALE_REGISTRY
            .map(({ code }) => code)
            .filter((locale) => readListing(locale).reviewed);

        expect(SHIPPED_LOCALES).toEqual(reviewed);
    });
});

describe('assembleDescription', () => {
    it('renders intro, dashed bullets, and disclaimer separated by blank lines', () => {
        const assembled = assembleDescription({
            intro: 'Intro.',
            bullets: ['First.', 'Second.'],
            disclaimer: 'Disclaimer.',
        });
        expect(assembled).toBe('Intro.\n\n- First.\n- Second.\n\nDisclaimer.');
    });
});

describe('collectListingIssues', () => {
    it('rejects a translation that drops a reviewed bullet', () => {
        const broken = structuredClone(base);
        broken.description.bullets = broken.description.bullets.slice(1);
        expect(collectListingIssues(broken, base).join('\n')).toContain('bullets');
    });

    it('rejects a translated brand string', () => {
        const broken = structuredClone(base);
        broken.description.intro = broken.description.intro.replaceAll('Split for Hacker News', 'Translated Name');
        expect(collectListingIssues(broken, base).join('\n')).toContain('brand');
    });

    it('rejects a dropped disclaimer proper noun', () => {
        const broken = structuredClone(base);
        broken.description.disclaimer = 'Unofficial project.';
        expect(collectListingIssues(broken, base).join('\n')).toContain('Y Combinator');
    });

    it('rejects an App Store keyword string over budget', () => {
        const broken = structuredClone(base);
        broken.appStoreKeywords = 'k'.repeat(101);
        expect(collectListingIssues(broken, base).join('\n')).toContain('App Store limit');
    });

    it('rejects search terms over the Edge word budget', () => {
        const broken = structuredClone(base);
        broken.searchTerms = ['a b c d e f g h', 'i j k l m n o p', 'q r s t u v w x'];
        expect(collectListingIssues(broken, base).join('\n')).toContain('Edge limit');
    });
});

describe('countSearchTermWords', () => {
    it('counts whitespace-separated words across terms', () => {
        expect(countSearchTermWords(['hacker news', 'hn', 'side panel'])).toBe(5);
    });
});

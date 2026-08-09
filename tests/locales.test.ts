import { describe, expect, it } from 'vitest';

import {
    BASE_LOCALE,
    CHROME_PACKAGED_LOCALE_ALIASES,
    CHROME_PACKAGED_LOCALES,
    LOCALE_REGISTRY,
    SHIPPED_LOCALES,
    resolveShippedLocale,
} from '../src/shared/locales';

const PRIORITY_LOCALES = [
    'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
    'es_419', 'fa', 'fi', 'fil', 'fr', 'he', 'hi', 'hr', 'hu', 'id',
    'it', 'ja', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt_BR', 'pt_PT', 'ro',
    'ru', 'sk', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW',
];

describe('locale registry', () => {
    it('contains exactly the 40 priority locales in order', () => {
        expect(LOCALE_REGISTRY.map(({ code }) => code)).toEqual(PRIORITY_LOCALES);
        expect(PRIORITY_LOCALES).toHaveLength(40);
    });

    it('has unique codes and non-empty names', () => {
        const codes = LOCALE_REGISTRY.map(({ code }) => code);
        expect(new Set(codes).size).toBe(LOCALE_REGISTRY.length);
        expect(LOCALE_REGISTRY.every(({ englishName }) => englishName.length > 0)).toBe(true);
    });

    it('flags exactly the right-to-left locales', () => {
        const rtl = LOCALE_REGISTRY.filter(({ rtl: isRtl }) => isRtl).map(({ code }) => code);
        expect(rtl).toEqual(['ar', 'fa', 'he']);
    });

    it('ships every release-reviewed priority catalog', () => {
        const codes = new Set(LOCALE_REGISTRY.map(({ code }) => code));
        expect(SHIPPED_LOCALES).toEqual(PRIORITY_LOCALES);
        expect(SHIPPED_LOCALES.every((code) => codes.has(code))).toBe(true);
        expect(SHIPPED_LOCALES).toContain(BASE_LOCALE);
    });

    it('configures one generated Norwegian alias for Chrome', () => {
        expect(CHROME_PACKAGED_LOCALE_ALIASES).toEqual({ no: 'nb' });
        expect(CHROME_PACKAGED_LOCALES).toEqual([...PRIORITY_LOCALES, 'no']);
        expect(new Set(CHROME_PACKAGED_LOCALES).size).toBe(41);
    });

    it('maps regional variants to lowercase library codes', () => {
        const byCode = new Map(LOCALE_REGISTRY.map((entry) => [entry.code, entry.adguardCode]));
        expect(byCode.get('pt_BR')).toBe('pt_br');
        expect(byCode.get('pt_PT')).toBe('pt_pt');
        expect(byCode.get('zh_CN')).toBe('zh_cn');
        expect(byCode.get('zh_TW')).toBe('zh_tw');
        expect(byCode.get('es_419')).toBe('es');
        expect(byCode.get('nb')).toBe('nb');
    });
});

describe('resolveShippedLocale', () => {
    it.each(LOCALE_REGISTRY.map(({ code }) => [code, code.toLowerCase()] as const))(
        'resolves the exact shipped catalog %s',
        (code, normalizedCode) => {
            expect(resolveShippedLocale(normalizedCode)?.code).toBe(code);
        },
    );

    it.each([
        ['ru', 'ru'],
        ['ru_ru', 'ru'],
        ['en', 'en'],
        ['en_us', 'en'],
        ['en_gb', 'en'],
        ['de', 'de'],
        ['nb', 'nb'],
        ['nb_no', 'nb'],
        ['no', 'nb'],
        ['no_no', 'nb'],
        ['zh_cn', 'zh_cn'],
        ['zh_tw', 'zh_tw'],
        ['zh', 'zh_cn'],
        ['pt', 'pt_br'],
        ['pt_pt', 'pt_pt'],
        ['es_419', 'es'],
        ['es_mx', 'es'],
    ])('resolves %s to shipped locale %s', (uiLanguage, expected) => {
        expect(resolveShippedLocale(uiLanguage)?.adguardCode).toBe(expected);
    });

    it('maps the Norwegian Web Store alias to the runtime Bokmål entry', () => {
        expect(resolveShippedLocale('no')?.code).toBe('nb');
    });

    it.each([
        'lv', 'xx', '',
    ])('returns undefined for an unshipped language %s', (uiLanguage) => {
        expect(resolveShippedLocale(uiLanguage)).toBeUndefined();
    });
});

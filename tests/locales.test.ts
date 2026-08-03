import { describe, expect, it } from 'vitest';

import {
    BASE_LOCALE,
    LOCALE_REGISTRY,
    SHIPPED_LOCALES,
    resolveShippedLocale,
} from '../src/shared/locales';

const PRIORITY_LOCALES = [
    'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
    'es_419', 'fa', 'fi', 'fil', 'fr', 'he', 'hi', 'hr', 'hu', 'id',
    'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt_BR', 'pt_PT', 'ro',
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

    it('ships only registry locales and includes the base locale', () => {
        const codes = new Set(LOCALE_REGISTRY.map(({ code }) => code));
        expect(SHIPPED_LOCALES.every((code) => codes.has(code))).toBe(true);
        expect(SHIPPED_LOCALES).toContain(BASE_LOCALE);
    });

    it('maps regional variants to lowercase library codes', () => {
        const byCode = new Map(LOCALE_REGISTRY.map((entry) => [entry.code, entry.adguardCode]));
        expect(byCode.get('pt_BR')).toBe('pt_br');
        expect(byCode.get('pt_PT')).toBe('pt_pt');
        expect(byCode.get('zh_CN')).toBe('zh_cn');
        expect(byCode.get('zh_TW')).toBe('zh_tw');
        expect(byCode.get('es_419')).toBe('es');
    });
});

describe('resolveShippedLocale', () => {
    it.each([
        ['ru', 'ru'],
        ['ru_ru', 'ru'],
        ['en', 'en'],
        ['en_us', 'en'],
        ['en_gb', 'en'],
    ])('resolves %s to shipped locale %s', (uiLanguage, expected) => {
        expect(resolveShippedLocale(uiLanguage)?.adguardCode).toBe(expected);
    });

    it.each(['de', 'zh_cn', 'es_419', ''])('returns undefined for unshipped language %s', (uiLanguage) => {
        expect(resolveShippedLocale(uiLanguage)).toBeUndefined();
    });
});

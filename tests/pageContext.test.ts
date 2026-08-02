import { afterEach, describe, expect, it } from 'vitest';

import { readPageContext } from '../src/page/context';

afterEach(() => {
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/');
});

describe('readPageContext', () => {
    it('returns the current URL and canonical URL', () => {
        window.history.replaceState({}, '', '/article?utm_source=test');
        const canonical = document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = '/article';
        document.head.append(canonical);

        expect(readPageContext()).toEqual({
            pageUrl: 'http://localhost:3000/article?utm_source=test',
            canonicalHref: 'http://localhost:3000/article',
        });
    });

    it('returns null when the page has no canonical URL', () => {
        expect(readPageContext().canonicalHref).toBeNull();
    });
});

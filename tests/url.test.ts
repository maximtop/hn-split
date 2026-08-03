import { describe, expect, it } from 'vitest';

import { buildArticleCandidates, normalizeArticleUrl } from '../src/domain/url';

describe('normalizeArticleUrl', () => {
    it.each([
        ['https://example.com/story', 'example.com/story'],
        ['http://EXAMPLE.com:80/story/', 'example.com/story'],
        ['https://example.com:443/story#comments', 'example.com/story'],
        ['https://example.com/story?utm_source=hn&id=7', 'example.com/story?id=7'],
        ['https://example.com/story?ID=7&utm_campaign=x', 'example.com/story?ID=7'],
        ['https://example.com/story?id=1&id=2', 'example.com/story?id=1&id=2'],
        ['https://example.com/story?q=a%20b&utm_source=x', 'example.com/story?q=a+b'],
        ['https://example.com/story?q=a+b', 'example.com/story?q=a+b'],
        ['https://example.com/story?q=a~b', 'example.com/story?q=a%7Eb'],
        ['https://example.com/story?q=a%7Eb', 'example.com/story?q=a%7Eb'],
        ['https://example.com/story?keyword=key&zipcode=1', 'example.com/story?keyword=key&zipcode=1'],
        ['https://www.example.com/Story', 'www.example.com/Story'],
        ['https://example.com/amp/story', 'example.com/amp/story'],
        ['https://example.com./story', 'example.com/story'],
        ['https://[::ffff:8.8.8.8]/story', '[::ffff:808:808]/story'],
        ['https://[2002:0808:0808::]/story', '[2002:808:808::]/story'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeArticleUrl(input)).toBe(expected);
    });

    it.each([
        'mailto:editor@example.com',
        'https://user:pass@example.com/story',
        'http://localhost/story',
        'http://localhost./story',
        'http://printer/story',
        'http://service.local./story',
        'https://article.hn-split.example/story',
        'https://article.hn-split.test/story',
        'https://article.hn-split.invalid/story',
        'https://wiki.corp/story',
        'https://service.internal/story',
        'http://hiddenservice.onion/story',
        'http://router.home.arpa/story',
        'http://1.0.0.127.in-addr.arpa/story',
        'https://ipv4only.arpa/story',
        'https://service.alt/story',
        'https://example.com/callback?code=oauth-code&state=x',
        'https://example.com/reset?token=abc123',
        'https://example.com/story?access_token=abc123',
        'https://example.com/api?api_key=abc123',
        'https://example.com/download?sig=abc123',
        'https://example.com/download?X-Amz-Signature=abc&X-Amz-Credential=xyz',
        'https://example.com/download?X-Goog-Signature=abc',
        'https://example.com/session?JSESSIONID=abc123',
        'http://127.0.0.1/story',
        'http://192.168.1.3/story',
        'http://192.31.196.10/story',
        'http://192.52.193.10/story',
        'http://192.175.48.10/story',
        'http://100.64.0.1/story',
        'http://100.127.255.254/story',
        'http://198.18.0.1/story',
        'http://198.19.255.254/story',
        'http://192.0.2.1/story',
        'http://198.51.100.1/story',
        'http://203.0.113.1/story',
        'http://[::ffff:127.0.0.1]/story',
        'http://[::ffff:10.0.0.1]/story',
        'http://[::ffff:192.168.1.3]/story',
        'http://[::ffff:7f00:1]/story',
        'http://[::ffff:c000:201]/story',
        'http://[64:ff9b::808:808]/story',
        'http://[64:ff9b:1::1]/story',
        'http://[100::1]/story',
        'http://[2001::1]/story',
        'http://[2001:2::1]/story',
        'http://[2001:db8::1]/story',
        'http://[2002:0a00:0001::]/story',
        'http://[2002:c0a8:0101::]/story',
        'http://[3fff::1]/story',
        'http://[fc00::1]/story',
        'http://[fe80::1]/story',
        'http://[fec0::1]/story',
        'http://[ff02::1]/story',
    ])('rejects ineligible URL %s', (input) => {
        expect(normalizeArticleUrl(input)).toBeNull();
    });
});

describe('buildArticleCandidates', () => {
    it('places a valid canonical URL first and keeps a different page URL', () => {
        expect(buildArticleCandidates(
            'https://syndicator.example.com/post?utm_source=x',
            'https://publisher.example.com/article',
        )).toEqual([
            {
                url: 'https://publisher.example.com/article',
                identity: 'publisher.example.com/article',
                source: 'canonical',
            },
            {
                url: 'https://syndicator.example.com/post',
                identity: 'syndicator.example.com/post',
                source: 'page',
            },
        ]);
    });

    it('resolves relative canonical URLs and removes duplicate identities', () => {
        expect(buildArticleCandidates(
            'https://example.com/news/story?utm_medium=email',
            '/news/story',
        )).toEqual([
            {
                url: 'https://example.com/news/story',
                identity: 'example.com/news/story',
                source: 'canonical',
            },
        ]);
    });

    it('sanitizes outbound candidates while preserving semantic query parameters', () => {
        expect(buildArticleCandidates(
            'https://example.com/story?id=7&fbclid=secret#access_token=private',
        )).toEqual([{
            url: 'https://example.com/story?id=7',
            identity: 'example.com/story?id=7',
            source: 'page',
        }]);
    });

    it('ignores a malformed canonical URL', () => {
        expect(buildArticleCandidates('https://example.com/story', 'http://[')).toEqual([
            {
                url: 'https://example.com/story',
                identity: 'example.com/story',
                source: 'page',
            },
        ]);
    });

    it.each([
        'http://hiddenservice.onion/story',
        'http://router.home.arpa/story',
        'https://example.com/reset?token=abc123',
        'https://example.com/download?X-Amz-Signature=abc',
    ])('produces no candidate for special-use or credential-bearing URL %s', (pageUrl) => {
        expect(buildArticleCandidates(pageUrl)).toEqual([]);
    });

    it('drops only the credential-bearing candidate when the other one is clean', () => {
        expect(buildArticleCandidates(
            'https://example.com/story?token=abc123',
            'https://example.com/story',
        )).toEqual([{
            url: 'https://example.com/story',
            identity: 'example.com/story',
            source: 'canonical',
        }]);
    });
});

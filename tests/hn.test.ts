import { afterEach, describe, expect, it, vi } from 'vitest';

import { discussionUrl, lookupHnDiscussions } from '../src/domain/hn';
import { buildArticleCandidates } from '../src/domain/url';
import type { ArticleCandidate } from '../src/domain/url';

const candidate = (url: string, identity: string): ArticleCandidate => ({
    url,
    identity,
    source: 'page',
});

const jsonResponse = (hits: unknown[]): Response => new Response(JSON.stringify({ hits }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
});

/**
 * Creates a fetch stub that stays pending until its abort signal fires.
 */
const signalBoundFetch = (): ReturnType<typeof vi.fn<typeof fetch>> => vi.fn<typeof fetch>(
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason instanceof Error
                ? init.signal.reason
                : new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    }),
);

afterEach(() => {
    vi.useRealTimers();
});

describe('lookupHnDiscussions', () => {
    it('keeps exact URL matches, deduplicates IDs, and ranks active discussions first', async () => {
        const fetchFn = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse([
                {
                    objectID: '10',
                    url: 'https://example.com/story?utm_source=hn',
                    title: 'Older active discussion',
                    num_comments: 30,
                    points: 50,
                    created_at_i: 100,
                },
                {
                    objectID: '11',
                    url: 'https://example.com/other',
                    title: 'Fuzzy search result',
                    num_comments: 100,
                    points: 100,
                    created_at_i: 200,
                },
            ]))
            .mockResolvedValueOnce(jsonResponse([
                {
                    objectID: '10',
                    url: 'http://example.com/story',
                    title: 'Duplicate',
                    num_comments: 30,
                    points: 50,
                    created_at_i: 100,
                },
                {
                    objectID: '12',
                    url: 'https://publisher.example.com/article',
                    title: 'Newer quiet discussion',
                    num_comments: 2,
                    points: 200,
                    created_at_i: 300,
                },
            ]));

        const result = await lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
            candidate('https://publisher.example.com/article', 'publisher.example.com/article'),
        ], fetchFn);

        expect(result).toEqual({
            status: 'found',
            primary: expect.objectContaining({ id: '10', comments: 30 }),
            alternatives: [expect.objectContaining({ id: '12', comments: 2 })],
        });
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('sanitizes the URL sent to Algolia even for an unsanitized candidate', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

        await lookupHnDiscussions([
            candidate(
                'https://example.com/story?id=7&fbclid=secret#access_token=private',
                'example.com/story?id=7',
            ),
        ], fetchFn);

        const requestUrl = new URL(String(fetchFn.mock.calls[0]?.[0]));
        expect(requestUrl.searchParams.get('query')).toBe('https://example.com/story?id=7');
    });

    it('uses points, time, and ID as stable ranking tie-breakers', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
            { objectID: '8', url: 'https://example.com/story', num_comments: 4, points: 20, created_at_i: 30 },
            { objectID: '9', url: 'https://example.com/story', num_comments: 4, points: 20, created_at_i: 30 },
            { objectID: '7', url: 'https://example.com/story', num_comments: 4, points: 30, created_at_i: 10 },
        ]));

        const result = await lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn);

        expect(result.status).toBe('found');
        if (result.status === 'found') {
            expect([result.primary, ...result.alternatives].map(({ id }) => id)).toEqual(['7', '9', '8']);
        }
    });

    it('returns not_found only when every request succeeds without an exact match', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
            { objectID: '1', url: 'https://example.com/different' },
        ]));

        await expect(lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn)).resolves.toEqual({ status: 'not_found' });
    });

    it('returns restricted when there are no eligible candidates', async () => {
        const fetchFn = vi.fn<typeof fetch>();

        await expect(lookupHnDiscussions([], fetchFn)).resolves.toEqual({ status: 'restricted' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('returns an error when lookup fails and no exact result is available', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));

        await expect(lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn)).resolves.toEqual({ status: 'error', reason: 'lookup_failed' });
    });

    it('aborts at the five-second deadline and reports a lookup failure', async () => {
        vi.useFakeTimers();
        const fetchFn = signalBoundFetch();

        const pending = lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        await expect(pending).resolves.toEqual({ status: 'error', reason: 'lookup_failed' });
        expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it('cancels the lookup as soon as the caller signal aborts', async () => {
        vi.useFakeTimers();
        const fetchFn = signalBoundFetch();
        const caller = new AbortController();

        const pending = lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn, caller.signal);
        await vi.advanceTimersByTimeAsync(10);
        caller.abort();

        await expect(pending).resolves.toEqual({ status: 'error', reason: 'lookup_failed' });
        expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it('never fetches for special-use or credential-bearing page URLs', async () => {
        const fetchFn = vi.fn<typeof fetch>();

        await expect(lookupHnDiscussions(
            buildArticleCandidates('http://hiddenservice.onion/story'),
            fetchFn,
        )).resolves.toEqual({ status: 'restricted' });
        await expect(lookupHnDiscussions(
            buildArticleCandidates('https://example.com/reset?token=abc123'),
            fetchFn,
        )).resolves.toEqual({ status: 'restricted' });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it.each([
        {},
        { objectID: '0', url: 'https://example.com/story' },
        { objectID: String(Number.MAX_SAFE_INTEGER + 1), url: 'https://example.com/story' },
        { objectID: '1', url: 'https://example.com/story', num_comments: 'many' },
        { objectID: '1', url: 'https://example.com/story', num_comments: -1 },
        { objectID: '1', url: 'https://example.com/story', num_comments: Number.MAX_SAFE_INTEGER + 1 },
        { objectID: '1', url: 'https://example.com/story', points: 1.5 },
        { objectID: '1', url: 'https://example.com/story', points: Number.POSITIVE_INFINITY },
        { objectID: '1', url: 'https://example.com/story', created_at_i: -1 },
        { objectID: '1', url: 'https://example.com/story', created_at_i: Number.MAX_SAFE_INTEGER + 1 },
    ])('returns invalid_response for malformed individual hit %#', async (hit) => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([hit]));

        await expect(lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn)).resolves.toEqual({ status: 'error', reason: 'invalid_response' });
    });

    it('returns an error for a malformed successful response', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"wrong":true}', {
            status: 200,
        }));

        await expect(lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn)).resolves.toEqual({ status: 'error', reason: 'invalid_response' });
    });

    it('classifies syntactically malformed JSON as an invalid response', async () => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('<!doctype html>Not JSON', {
            status: 200,
        }));

        await expect(lookupHnDiscussions([
            candidate('https://example.com/story', 'example.com/story'),
        ], fetchFn)).resolves.toEqual({ status: 'error', reason: 'invalid_response' });
    });
});

describe('discussionUrl', () => {
    it('creates one concrete Hacker News item URL', () => {
        expect(discussionUrl('123')).toBe('https://news.ycombinator.com/item?id=123');
    });

    it.each([
        '0',
        '12&next=evil',
        '9007199254740992',
    ])('rejects invalid item ID %s', (itemId) => {
        expect(() => discussionUrl(itemId)).toThrow('Invalid Hacker News item ID');
    });
});

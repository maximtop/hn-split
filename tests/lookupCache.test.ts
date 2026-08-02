import { describe, expect, it, vi } from 'vitest';

import { clearLookupCacheEntries, lookupWithCache } from '../src/browser/lookupCache';
import type { CacheStorage } from '../src/browser/lookupCache';
import type { HnLookupResult } from '../src/domain/hn';
import type { ArticleCandidate } from '../src/domain/url';

const candidates: ArticleCandidate[] = [{
    url: 'https://example.com/story',
    identity: 'example.com/story',
    source: 'page',
}];

const createStorage = (): CacheStorage & {
    records: Map<string, unknown>;
    remove: ReturnType<typeof vi.fn>;
} => {
    const records = new Map<string, unknown>();
    return {
        records,
        get: vi.fn(async (key) => records.get(key)),
        set: vi.fn(async (key, value) => {
            records.set(key, value);
        }),
        remove: vi.fn(async (key: string) => {
            records.delete(key);
        }),
    };
};

describe('lookupWithCache', () => {
    it('continues with lookup when the cache read fails', async () => {
        const storage = createStorage();
        vi.mocked(storage.get).mockRejectedValue(new Error('storage unavailable'));
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'restricted' });

        await expect(lookupWithCache(candidates, storage, lookup, 1_000))
            .resolves.toEqual({ status: 'restricted' });
        expect(lookup).toHaveBeenCalledOnce();
    });

    it('reuses an unexpired cached result', async () => {
        const storage = createStorage();
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });

        await lookupWithCache(candidates, storage, lookup, 1_000);
        await lookupWithCache(candidates, storage, lookup, 1_001);

        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('returns a valid lookup result when the cache write fails', async () => {
        const storage = createStorage();
        vi.mocked(storage.set).mockRejectedValue(new Error('storage full'));
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });

        await expect(lookupWithCache(candidates, storage, lookup, 1_000))
            .resolves.toEqual({ status: 'not_found' });
    });

    it('refreshes an expired negative result after ten minutes', async () => {
        const storage = createStorage();
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });

        await lookupWithCache(candidates, storage, lookup, 1_000);
        await lookupWithCache(candidates, storage, lookup, 1_000 + 10 * 60 * 1_000 + 1);

        expect(lookup).toHaveBeenCalledTimes(2);
        expect(storage.remove).toHaveBeenCalledOnce();
    });

    it('continues with lookup when removing an expired record fails', async () => {
        const storage = createStorage();
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });
        await lookupWithCache(candidates, storage, lookup, 1_000);
        vi.mocked(storage.remove).mockRejectedValue(new Error('storage unavailable'));

        await expect(lookupWithCache(candidates, storage, lookup, 1_000 + 10 * 60 * 1_000 + 1))
            .resolves.toEqual({ status: 'not_found' });
        expect(lookup).toHaveBeenCalledTimes(2);
    });

    it('uses an injective cache key for ordered candidate identities', async () => {
        const storage = createStorage();
        const firstCandidates: ArticleCandidate[] = [
            { url: 'https://example.com/one', identity: 'a|b', source: 'canonical' },
            { url: 'https://example.com/two', identity: 'c', source: 'page' },
        ];
        const secondCandidates: ArticleCandidate[] = [
            { url: 'https://example.com/one', identity: 'a', source: 'canonical' },
            { url: 'https://example.com/two', identity: 'b|c', source: 'page' },
        ];
        const firstLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });
        const secondLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });

        await lookupWithCache(firstCandidates, storage, firstLookup, 1_000);
        await lookupWithCache(secondCandidates, storage, secondLookup, 1_001);

        expect(secondLookup).toHaveBeenCalledOnce();
        expect(storage.records.size).toBe(2);
    });

    it('ignores cached data with a malformed lookup result', async () => {
        const storage = createStorage();
        const seedLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'not_found' });
        await lookupWithCache(candidates, storage, seedLookup, 1_000);
        const key = [...storage.records.keys()][0];
        expect(key).toBeDefined();
        if (key !== undefined) {
            storage.records.set(key, {
                expiresAt: 9_999,
                result: { status: 'found' },
            });
        }
        const refreshLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'restricted' });

        await expect(lookupWithCache(candidates, storage, refreshLookup, 1_001))
            .resolves.toEqual({ status: 'restricted' });
        expect(refreshLookup).toHaveBeenCalledOnce();
    });

    it.each([
        { id: '0' },
        { id: String(Number.MAX_SAFE_INTEGER + 1) },
        { comments: -1 },
        { comments: Number.MAX_SAFE_INTEGER + 1 },
        { points: 1.5 },
        { createdAt: Number.MAX_SAFE_INTEGER + 1 },
    ])('ignores cached discussions with unsafe numeric data %#', async (override) => {
        const storage = createStorage();
        await lookupWithCache(candidates, storage, async () => ({ status: 'not_found' }), 1_000);
        const key = [...storage.records.keys()][0];
        expect(key).toBeDefined();
        if (key !== undefined) {
            storage.records.set(key, {
                expiresAt: 9_999,
                result: {
                    status: 'found',
                    primary: {
                        id: '1',
                        title: 'Discussion',
                        articleUrl: 'https://example.com/story',
                        comments: 1,
                        points: 1,
                        createdAt: 1,
                        ...override,
                    },
                    alternatives: [],
                },
            });
        }
        const refreshLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'restricted' });

        await expect(lookupWithCache(candidates, storage, refreshLookup, 1_001))
            .resolves.toEqual({ status: 'restricted' });
        expect(refreshLookup).toHaveBeenCalledOnce();
    });

    it('ignores a cache record with an unsafe expiry timestamp', async () => {
        const storage = createStorage();
        await lookupWithCache(candidates, storage, async () => ({ status: 'not_found' }), 1_000);
        const key = [...storage.records.keys()][0];
        expect(key).toBeDefined();
        if (key !== undefined) {
            storage.records.set(key, {
                expiresAt: Number.MAX_SAFE_INTEGER + 1,
                result: { status: 'not_found' },
            });
        }
        const refreshLookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({ status: 'restricted' });

        await expect(lookupWithCache(candidates, storage, refreshLookup, 1_001))
            .resolves.toEqual({ status: 'restricted' });
        expect(refreshLookup).toHaveBeenCalledOnce();
    });

    it('does not cache errors', async () => {
        const storage = createStorage();
        const lookup = vi.fn<() => Promise<HnLookupResult>>().mockResolvedValue({
            status: 'error',
            reason: 'lookup_failed',
        });

        await lookupWithCache(candidates, storage, lookup, 1_000);
        await lookupWithCache(candidates, storage, lookup, 1_001);

        expect(lookup).toHaveBeenCalledTimes(2);
        expect(storage.set).not.toHaveBeenCalled();
    });
});

describe('clearLookupCacheEntries', () => {
    it('removes every lookup entry without touching discussion associations or unrelated session data', async () => {
        const remove = vi.fn(async () => undefined);
        const storage = {
            getAll: vi.fn(async () => ({
                'hn_lookup_v1:["example.com/one"]': { result: { status: 'not_found' } },
                'discussion_tab:7': 8,
                unrelated: 'preserve me',
                'hn_lookup_v1:["example.com/two"]': { result: { status: 'not_found' } },
            })),
            remove,
        };

        await clearLookupCacheEntries(storage);

        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith([
            'hn_lookup_v1:["example.com/one"]',
            'hn_lookup_v1:["example.com/two"]',
        ]);
    });

    it('does not issue a broad remove when no lookup entries exist', async () => {
        const remove = vi.fn(async () => undefined);

        await clearLookupCacheEntries({
            getAll: vi.fn(async () => ({ 'discussion_tab:7': 8 })),
            remove,
        });

        expect(remove).not.toHaveBeenCalled();
    });
});

import { HN_LOOKUP_STATUS, isHnLookupResult } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import type { ArticleCandidate } from '../domain/url';

const POSITIVE_TTL_MS = 60 * 60 * 1_000;
const NEGATIVE_TTL_MS = 10 * 60 * 1_000;
const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = `hn_lookup_v${CACHE_VERSION}:`;

/**
 * Describes one validated session-cache record.
 */
interface CacheRecord {
    /**
     * Contains the expiration time as Unix milliseconds.
     */
    expiresAt: number;
    /**
     * Contains the validated lookup result.
     */
    result: HnLookupResult;
}

/**
 * Defines key-level operations for lookup cache storage.
 */
export interface CacheStorage {
    /**
     * Reads one unknown cache value.
     * @param key - The versioned lookup-cache key to read.
     */
    get(key: string): Promise<unknown>;
    /**
     * Writes one validated cache record.
     * @param key - The versioned lookup-cache key to write.
     * @param value - The validated lookup-cache record to persist.
     */
    set(key: string, value: CacheRecord): Promise<void>;
    /**
     * Removes one cache entry.
     * @param key - The versioned lookup-cache key to remove.
     */
    remove(key: string): Promise<void>;
}

/**
 * Builds a versioned cache key from normalized article identities.
 * @param candidates - The normalized article candidates used for the cache key.
 */
function cacheKey(candidates: ArticleCandidate[]): string {
    return `${CACHE_KEY_PREFIX}${JSON.stringify(candidates.map(({ identity }) => identity))}`;
}

/**
 * Defines collection operations for selective lookup-cache cleanup.
 */
export interface CacheCollectionStorage {
    /**
     * Reads every session-storage entry.
     */
    getAll(): Promise<Record<string, unknown>>;
    /**
     * Removes only the provided session-storage keys.
     * @param keys - The lookup-cache keys to remove from session storage.
     */
    remove(keys: string[]): Promise<void>;
}

/**
 * Removes only versioned HN lookup entries from session storage.
 * @param storage - The session-storage adapter that owns lookup cache records.
 */
export async function clearLookupCacheEntries(storage: CacheCollectionStorage): Promise<void> {
    const entries = await storage.getAll();
    const lookupKeys = Object.keys(entries).filter((key) => key.startsWith(CACHE_KEY_PREFIX));
    if (lookupKeys.length > 0) {
        await storage.remove(lookupKeys);
    }
}

/**
 * Determines whether an unknown value is a non-null object record.
 * @param value - The unknown cache value to inspect.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Determines whether an unknown value is a valid lookup-cache record.
 * @param value - The unknown cache value to validate.
 */
function isCacheRecord(value: unknown): value is CacheRecord {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.expiresAt === 'number'
        && Number.isSafeInteger(value.expiresAt)
        && value.expiresAt > 0
        && isHnLookupResult(value.result);
}

/**
 * Returns a fresh cached lookup or performs and conditionally caches a new lookup.
 * @param candidates - The normalized article candidates used for the lookup.
 * @param storage - The session-storage adapter that owns lookup cache records.
 * @param lookup - The lookup operation to run after a cache miss.
 * @param now - The current timestamp used to evaluate and store expiry.
 */
export async function lookupWithCache(
    candidates: ArticleCandidate[],
    storage: CacheStorage,
    lookup: () => Promise<HnLookupResult>,
    now = Date.now(),
): Promise<HnLookupResult> {
    const key = cacheKey(candidates);
    let cached: unknown;
    try {
        cached = await storage.get(key);
    } catch {
        cached = undefined;
    }
    if (isCacheRecord(cached) && cached.expiresAt > now) {
        return cached.result;
    }
    if (isCacheRecord(cached)) {
        try {
            await storage.remove(key);
        } catch {
            // Expired cache cleanup is best-effort.
        }
    }

    const result = await lookup();
    const ttl = result.status === HN_LOOKUP_STATUS.FOUND
        ? POSITIVE_TTL_MS
        : result.status === HN_LOOKUP_STATUS.NOT_FOUND ? NEGATIVE_TTL_MS : null;
    if (ttl !== null) {
        try {
            await storage.set(key, {
                expiresAt: now + ttl,
                result,
            });
        } catch {
            // Cache availability must not affect a successful lookup.
        }
    }
    return result;
}

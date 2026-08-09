import { describe, expect, it, vi } from 'vitest';

import { reportsAutomaticAvailabilityNavigation } from '../src/background/automatic-availability-controller';
import { AutomaticAvailabilityUpdater } from '../src/browser/automatic-availability';
import type { AutomaticAvailabilityDependencies } from '../src/browser/automatic-availability';
import type { HnLookupResult } from '../src/domain/hn';
import { EXTENSION_BRAND } from '../src/shared/brand';

function dependencies(): AutomaticAvailabilityDependencies {
    return {
        isEnabled: vi.fn(async () => true),
        lookup: vi.fn(async (): Promise<HnLookupResult> => ({ status: 'not_found' })),
        applyBadge: vi.fn(async () => undefined),
    };
}

describe('reportsAutomaticAvailabilityNavigation', () => {
    it('recognizes a URL-bearing update without reading its URL value', () => {
        const readUrl = vi.fn(() => {
            throw new Error('The URL value must stay unread before opt-in');
        });
        const changeInfo = Object.defineProperty({}, 'url', { get: readUrl }) as chrome.tabs.OnUpdatedInfo;

        expect(reportsAutomaticAvailabilityNavigation(changeInfo)).toBe(true);
        expect(readUrl).not.toHaveBeenCalled();
    });
});

describe('AutomaticAvailabilityUpdater', () => {
    it('does not read a navigation URL until automatic mode is enabled', async () => {
        const deps = dependencies();
        vi.mocked(deps.isEnabled).mockResolvedValue(false);
        const readUrl = vi.fn(async () => 'https://example.com/article');
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.updateCurrentTab(7, readUrl);

        expect(readUrl).not.toHaveBeenCalled();
        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.applyBadge).not.toHaveBeenCalled();

        vi.mocked(deps.isEnabled).mockResolvedValue(true);
        await updater.updateCurrentTab(7, readUrl);

        expect(readUrl).toHaveBeenCalledOnce();
        expect(deps.lookup).toHaveBeenCalledWith('https://example.com/article', expect.any(AbortSignal));
    });

    it('ignores an older current-tab URL read that resolves after a newer navigation', async () => {
        const deps = dependencies();
        let resolveOlderRead!: (url: string | undefined) => void;
        const readOlderUrl = vi.fn(() => new Promise<string | undefined>((resolve) => {
            resolveOlderRead = resolve;
        }));
        const readCurrentUrl = vi.fn(async () => 'https://example.com/current');
        const updater = new AutomaticAvailabilityUpdater(deps);

        const olderUpdate = updater.updateCurrentTab(7, readOlderUrl);
        await vi.waitFor(() => expect(readOlderUrl).toHaveBeenCalledOnce());
        const currentUpdate = updater.updateCurrentTab(7, readCurrentUrl);
        await currentUpdate;
        resolveOlderRead('https://example.com/older');
        await olderUpdate;

        expect(deps.lookup).toHaveBeenCalledExactlyOnceWith(
            'https://example.com/current',
            expect.any(AbortSignal),
        );
    });

    it('holds an older lookup result while awaiting the newer current-tab URL', async () => {
        const deps = dependencies();
        let resolveOlderLookup!: (value: HnLookupResult) => void;
        let resolveCurrentRead!: (url: string | undefined) => void;
        const olderLookup = new Promise<HnLookupResult>((resolve) => {
            resolveOlderLookup = resolve;
        });
        vi.mocked(deps.lookup).mockReturnValueOnce(olderLookup);
        const readCurrentUrl = vi.fn(() => new Promise<string | undefined>((resolve) => {
            resolveCurrentRead = resolve;
        }));
        const updater = new AutomaticAvailabilityUpdater(deps);

        const olderUpdate = updater.update(7, 'https://example.com/older');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());
        const currentUpdate = updater.updateCurrentTab(7, readCurrentUrl);
        await vi.waitFor(() => expect(readCurrentUrl).toHaveBeenCalledOnce());
        resolveOlderLookup({
            status: 'found',
            primary: {
                id: '1', title: 'Older', articleUrl: 'https://example.com/older',
                comments: 99, points: 1, createdAt: 1,
            },
            alternatives: [],
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(deps.applyBadge).not.toHaveBeenCalledWith(7, expect.objectContaining({ text: '99' }));

        resolveCurrentRead('https://example.com/current');
        await Promise.all([olderUpdate, currentUpdate]);
        expect(deps.lookup).toHaveBeenCalledTimes(2);
    });

    it('deduplicates overlapping current-tab events that resolve to the same URL', async () => {
        const deps = dependencies();
        let resolveLookup!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup).mockReturnValueOnce(new Promise<HnLookupResult>((resolve) => {
            resolveLookup = resolve;
        }));
        const readUrl = vi.fn(async () => 'https://example.com/article');
        const updater = new AutomaticAvailabilityUpdater(deps);

        const firstUpdate = updater.updateCurrentTab(7, readUrl);
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());
        const duplicateUpdate = updater.updateCurrentTab(7, readUrl);
        await duplicateUpdate;

        expect(deps.lookup).toHaveBeenCalledOnce();

        resolveLookup({
            status: 'found',
            primary: {
                id: '1', title: 'Current', articleUrl: 'https://example.com/article',
                comments: 17, points: 1, createdAt: 1,
            },
            alternatives: [],
        });
        await firstUpdate;

        expect(deps.applyBadge).toHaveBeenCalledWith(7, expect.objectContaining({ text: '17' }));
    });

    it('keeps a restarted same-URL lookup scheduled when the superseded lookup rejects', async () => {
        const deps = dependencies();
        let rejectOlderLookup!: (reason: unknown) => void;
        let resolveCurrentLookup!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup)
            .mockReturnValueOnce(new Promise<HnLookupResult>((_resolve, reject) => {
                rejectOlderLookup = reject;
            }))
            .mockReturnValueOnce(new Promise<HnLookupResult>((resolve) => {
                resolveCurrentLookup = resolve;
            }));
        const updater = new AutomaticAvailabilityUpdater(deps);
        const url = 'https://example.com/article';

        const olderUpdate = updater.update(7, url);
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());
        const currentUpdate = updater.refresh(7, url);
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(2));
        rejectOlderLookup(new Error('superseded'));
        await olderUpdate;

        await updater.updateCurrentTab(7, async () => url);
        expect(deps.lookup).toHaveBeenCalledTimes(2);

        resolveCurrentLookup({
            status: 'found',
            primary: {
                id: '1', title: 'Current', articleUrl: url,
                comments: 23, points: 1, createdAt: 1,
            },
            alternatives: [],
        });
        await currentUpdate;

        expect(deps.applyBadge).toHaveBeenCalledWith(7, expect.objectContaining({ text: '23' }));
    });

    it('releases a pending URL read when automatic mode is disabled', async () => {
        const deps = dependencies();
        let resolveOlderLookup!: (value: HnLookupResult) => void;
        let resolvePendingRead!: (url: string | undefined) => void;
        vi.mocked(deps.lookup).mockReturnValueOnce(new Promise<HnLookupResult>((resolve) => {
            resolveOlderLookup = resolve;
        }));
        const updater = new AutomaticAvailabilityUpdater(deps);

        const olderUpdate = updater.update(7, 'https://example.com/older');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());
        const pendingUpdate = updater.updateCurrentTab(7, () => new Promise((resolve) => {
            resolvePendingRead = resolve;
        }));
        await vi.waitFor(() => expect(resolvePendingRead).toBeTypeOf('function'));
        resolveOlderLookup({
            status: 'found',
            primary: {
                id: '1', title: 'Older', articleUrl: 'https://example.com/older',
                comments: 99, points: 1, createdAt: 1,
            },
            alternatives: [],
        });

        await Promise.all([olderUpdate, updater.disable([7])]);

        expect(deps.applyBadge).not.toHaveBeenCalledWith(7, expect.objectContaining({ text: '99' }));
        expect(deps.applyBadge).toHaveBeenCalledWith(7, {
            text: '',
            title: EXTENSION_BRAND,
        });

        resolvePendingRead('https://example.com/current');
        await pendingUpdate;
        expect(deps.lookup).toHaveBeenCalledOnce();
    });

    it('looks up the tab URL and applies the resulting badge in automatic mode', async () => {
        const deps = dependencies();
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledWith('https://example.com/article', expect.any(AbortSignal));
        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, {
            text: '',
            title: EXTENSION_BRAND,
        });
    });

    it('ignores the duplicate event Chrome fires for one navigation', async () => {
        const deps = dependencies();
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');
        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledTimes(1);
    });

    it('re-evaluates an already-scheduled URL through refresh', async () => {
        const deps = dependencies();
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');
        await updater.refresh(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledTimes(2);
    });

    it('lets the same URL retry after a failed lookup result', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup)
            .mockResolvedValueOnce({ status: 'error', reason: 'lookup_failed' })
            .mockResolvedValueOnce({ status: 'not_found' });
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');
        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledTimes(2);
    });

    it('re-checks a URL scheduled for a tab after that tab was forgotten', async () => {
        const deps = dependencies();
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');
        updater.forget(7);
        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledTimes(2);
    });

    it('aborts the superseded lookup when the tab navigates again', async () => {
        const deps = dependencies();
        const signals: AbortSignal[] = [];
        let releaseFirst!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup)
            .mockImplementationOnce(async (_url, signal) => {
                signals.push(signal);
                return new Promise((resolve) => {
                    releaseFirst = resolve;
                });
            })
            .mockImplementationOnce(async (_url, signal) => {
                signals.push(signal);
                return { status: 'not_found' };
            });
        const updater = new AutomaticAvailabilityUpdater(deps);

        const first = updater.update(7, 'https://example.com/old');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1));
        const second = updater.update(7, 'https://example.com/current');
        expect(signals[0]?.aborted).toBe(true);
        releaseFirst({ status: 'not_found' });
        await Promise.all([first, second]);

        expect(signals[1]?.aborted).toBe(false);
    });

    it('aborts an in-flight lookup when its tab is forgotten', async () => {
        const deps = dependencies();
        const signals: AbortSignal[] = [];
        let release!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup).mockImplementation(async (_url, signal) => {
            signals.push(signal);
            return new Promise((resolve) => {
                release = resolve;
            });
        });
        const updater = new AutomaticAvailabilityUpdater(deps);

        const update = updater.update(7, 'https://example.com/article');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1));
        updater.forget(7);
        expect(signals[0]?.aborted).toBe(true);
        release({ status: 'not_found' });
        await update;
    });

    it('aborts every in-flight lookup when automatic mode is disabled', async () => {
        const deps = dependencies();
        const signals: AbortSignal[] = [];
        let release!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup).mockImplementation(async (_url, signal) => {
            signals.push(signal);
            return new Promise((resolve) => {
                release = resolve;
            });
        });
        const updater = new AutomaticAvailabilityUpdater(deps);

        const update = updater.update(7, 'https://example.com/article');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1));
        const disable = updater.disable([7]);
        expect(signals[0]?.aborted).toBe(true);
        release({ status: 'not_found' });
        await Promise.all([disable, update]);
    });

    it('clears the previous page badge before starting the next lookup', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockReturnValue(new Promise(() => undefined));
        const updater = new AutomaticAvailabilityUpdater(deps);

        void updater.update(7, 'https://example.com/next');
        await vi.waitFor(() => {
            expect(deps.applyBadge).toHaveBeenCalledWith(7, {
                text: '',
                title: EXTENSION_BRAND,
            });
        });
    });

    it('does not retain a URL observed while automatic mode is disabled', async () => {
        const deps = dependencies();
        vi.mocked(deps.isEnabled).mockResolvedValue(false);
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.applyBadge).toHaveBeenCalledWith(7, {
            text: '',
            title: EXTENSION_BRAND,
        });

        vi.mocked(deps.isEnabled).mockResolvedValue(true);
        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledOnce();
    });

    it('does not let an older navigation overwrite the current tab badge', async () => {
        const deps = dependencies();
        let resolveFirst!: (value: Awaited<ReturnType<AutomaticAvailabilityDependencies['lookup']>>) => void;
        let resolveSecond!: (value: Awaited<ReturnType<AutomaticAvailabilityDependencies['lookup']>>) => void;
        const first = new Promise<Awaited<ReturnType<AutomaticAvailabilityDependencies['lookup']>>>((resolve) => {
            resolveFirst = resolve;
        });
        const second = new Promise<Awaited<ReturnType<AutomaticAvailabilityDependencies['lookup']>>>((resolve) => {
            resolveSecond = resolve;
        });
        vi.mocked(deps.lookup).mockReturnValueOnce(first).mockReturnValueOnce(second);
        const updater = new AutomaticAvailabilityUpdater(deps);

        const oldUpdate = updater.update(7, 'https://example.com/old');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1));
        const currentUpdate = updater.update(7, 'https://example.com/current');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(2));
        resolveSecond({
            status: 'found',
            primary: {
                id: '2', title: 'Current', articleUrl: 'https://example.com/current',
                comments: 2, points: 2, createdAt: 2,
            },
            alternatives: [],
        });
        await currentUpdate;
        resolveFirst({
            status: 'found',
            primary: {
                id: '1', title: 'Old', articleUrl: 'https://example.com/old',
                comments: 1, points: 1, createdAt: 1,
            },
            alternatives: [],
        });
        await oldUpdate;

        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, expect.objectContaining({ text: '2' }));
    });

    it('clears the badge when an automatic lookup fails', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockRejectedValue(new Error('offline'));
        const updater = new AutomaticAvailabilityUpdater(deps);

        await expect(updater.update(7, 'https://example.com/article')).resolves.toBeUndefined();

        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, {
            text: '',
            title: EXTENSION_BRAND,
        });
    });

    it('serializes badge mutations for the same tab through completion', async () => {
        const deps = dependencies();
        let releaseFirst!: () => void;
        const firstMutation = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let activeMutations = 0;
        let maximumActiveMutations = 0;
        vi.mocked(deps.applyBadge).mockImplementation(async () => {
            activeMutations += 1;
            maximumActiveMutations = Math.max(maximumActiveMutations, activeMutations);
            if (vi.mocked(deps.applyBadge).mock.calls.length === 1) {
                await firstMutation;
            }
            activeMutations -= 1;
        });
        const updater = new AutomaticAvailabilityUpdater(deps);

        const first = updater.update(7, 'https://example.com/first');
        await vi.waitFor(() => expect(deps.applyBadge).toHaveBeenCalledTimes(1));
        const second = updater.update(7, 'https://example.com/second');
        await Promise.resolve();

        expect(deps.applyBadge).toHaveBeenCalledTimes(1);
        releaseFirst();
        await Promise.all([first, second]);

        expect(maximumActiveMutations).toBe(1);
    });

    it('rechecks enabled state after lookup before applying an available badge', async () => {
        const deps = dependencies();
        vi.mocked(deps.isEnabled).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        vi.mocked(deps.lookup).mockResolvedValue({
            status: 'found',
            primary: {
                id: '1', title: 'Discussion', articleUrl: 'https://example.com/article',
                comments: 8, points: 2, createdAt: 1,
            },
            alternatives: [],
        });
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');

        expect(deps.isEnabled).toHaveBeenCalledTimes(2);
        expect(deps.applyBadge).not.toHaveBeenCalledWith(7, expect.objectContaining({ text: '8' }));
    });

    it('invalidates in-flight checks and leaves badges cleared when disabled', async () => {
        const deps = dependencies();
        let resolveLookup!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup).mockReturnValue(new Promise((resolve) => {
            resolveLookup = resolve;
        }));
        const updater = new AutomaticAvailabilityUpdater(deps);
        const update = updater.update(7, 'https://example.com/article');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());

        const disable = updater.disable([7]);
        resolveLookup({
            status: 'found',
            primary: {
                id: '1', title: 'Stale', articleUrl: 'https://example.com/article',
                comments: 8, points: 2, createdAt: 1,
            },
            alternatives: [],
        });
        await Promise.all([update, disable]);

        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, { text: '', title: EXTENSION_BRAND });
        expect(deps.applyBadge).not.toHaveBeenCalledWith(7, expect.objectContaining({ text: '8' }));
    });

    it('waits for in-flight automatic lookups before disable completes', async () => {
        const deps = dependencies();
        let resolveLookup!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup).mockReturnValue(new Promise((resolve) => {
            resolveLookup = resolve;
        }));
        const updater = new AutomaticAvailabilityUpdater(deps);
        const update = updater.update(7, 'https://example.com/article');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledOnce());
        let disableCompleted = false;

        const disable = updater.disable([7]).then(() => {
            disableCompleted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(disableCompleted).toBe(false);

        resolveLookup({ status: 'not_found' });
        await Promise.all([update, disable]);
        expect(disableCompleted).toBe(true);
    });

    it('reports badge-clear failures while disabling', async () => {
        const deps = dependencies();
        vi.mocked(deps.applyBadge).mockRejectedValue(new Error('action API failed'));
        const updater = new AutomaticAvailabilityUpdater(deps);

        await expect(updater.disable([7])).rejects.toThrow('action API failed');
    });

    it('does not let stale work match a reused tab identifier after forget', async () => {
        const deps = dependencies();
        let resolveOld!: (value: HnLookupResult) => void;
        let resolveNew!: (value: HnLookupResult) => void;
        vi.mocked(deps.lookup)
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveOld = resolve;
            }))
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveNew = resolve;
            }));
        const updater = new AutomaticAvailabilityUpdater(deps);

        const oldUpdate = updater.update(7, 'https://example.com/old');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(1));
        updater.forget(7);
        const newUpdate = updater.update(7, 'https://example.com/new');
        await vi.waitFor(() => expect(deps.lookup).toHaveBeenCalledTimes(2));

        resolveNew({
            status: 'found',
            primary: {
                id: '2', title: 'Current', articleUrl: 'https://example.com/new',
                comments: 22, points: 2, createdAt: 2,
            },
            alternatives: [],
        });
        await newUpdate;
        resolveOld({
            status: 'found',
            primary: {
                id: '1', title: 'Stale', articleUrl: 'https://example.com/old',
                comments: 11, points: 1, createdAt: 1,
            },
            alternatives: [],
        });
        await oldUpdate;

        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, expect.objectContaining({ text: '22' }));
        expect(deps.applyBadge).not.toHaveBeenLastCalledWith(7, expect.objectContaining({ text: '11' }));
    });

    it('forgets removed tab generations so future disables do not revisit them', async () => {
        const deps = dependencies();
        vi.mocked(deps.isEnabled).mockResolvedValue(false);
        const updater = new AutomaticAvailabilityUpdater(deps);
        await updater.update(7, 'https://example.com/article');
        expect(deps.applyBadge).toHaveBeenCalledTimes(1);

        updater.forget(7);
        await updater.disable([]);

        expect(deps.applyBadge).toHaveBeenCalledTimes(1);
    });
});

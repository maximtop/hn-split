import { describe, expect, it, vi } from 'vitest';

import { AutomaticAvailabilityUpdater } from '../src/browser/automatic-availability';
import type { AutomaticAvailabilityDependencies } from '../src/browser/automatic-availability';
import type { HnLookupResult } from '../src/domain/hn';

function dependencies(): AutomaticAvailabilityDependencies {
    return {
        isEnabled: vi.fn(async () => true),
        lookup: vi.fn(async (): Promise<HnLookupResult> => ({ status: 'not_found' })),
        applyBadge: vi.fn(async () => undefined),
    };
}

describe('AutomaticAvailabilityUpdater', () => {
    it('looks up the tab URL and applies the resulting badge in automatic mode', async () => {
        const deps = dependencies();
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).toHaveBeenCalledWith('https://example.com/article');
        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, {
            text: '',
            title: 'HN Split',
        });
    });

    it('clears the previous page badge before starting the next lookup', async () => {
        const deps = dependencies();
        vi.mocked(deps.lookup).mockReturnValue(new Promise(() => undefined));
        const updater = new AutomaticAvailabilityUpdater(deps);

        void updater.update(7, 'https://example.com/next');
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.applyBadge).toHaveBeenCalledWith(7, {
            text: '',
            title: 'HN Split',
        });
    });

    it('clears the badge without looking up when automatic mode is disabled', async () => {
        const deps = dependencies();
        vi.mocked(deps.isEnabled).mockResolvedValue(false);
        const updater = new AutomaticAvailabilityUpdater(deps);

        await updater.update(7, 'https://example.com/article');

        expect(deps.lookup).not.toHaveBeenCalled();
        expect(deps.applyBadge).toHaveBeenCalledWith(7, {
            text: '',
            title: 'HN Split',
        });
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
            title: 'HN Split',
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

        expect(deps.applyBadge).toHaveBeenLastCalledWith(7, { text: '', title: 'HN Split' });
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

import { badgeForLookupResult } from './availabilityBadge';
import type { AvailabilityBadge } from './availabilityBadge';
import type { HnLookupResult } from '../domain/hn';

const EMPTY_BADGE: AvailabilityBadge = { text: '', title: 'HN Split' };

export interface AutomaticAvailabilityDependencies {
    isEnabled(): Promise<boolean>;
    lookup(url: string): Promise<HnLookupResult>;
    applyBadge(tabId: number, badge: AvailabilityBadge): Promise<void>;
}

export interface AutomaticAvailabilityUpdater {
    update(tabId: number, url: string): Promise<void>;
    disable(tabIds: number[]): Promise<void>;
    forget(tabId: number): void;
}

export function createAutomaticAvailabilityUpdater(
    dependencies: AutomaticAvailabilityDependencies,
): AutomaticAvailabilityUpdater {
    const generations = new Map<number, number>();
    const badgeMutations = new Map<number, Promise<void>>();
    const inFlightUpdates = new Set<Promise<void>>();

    const nextGeneration = (tabId: number): number => {
        const generation = (generations.get(tabId) ?? 0) + 1;
        generations.set(tabId, generation);
        return generation;
    };

    const enqueueMutation = (
        tabId: number,
        generation: number,
        badge: AvailabilityBadge,
        requireEnabled: boolean,
    ): Promise<void> => {
        const previous = badgeMutations.get(tabId) ?? Promise.resolve();
        const mutation = previous.catch(() => undefined).then(async () => {
            if (generations.get(tabId) !== generation) {
                return;
            }
            if (requireEnabled && !await dependencies.isEnabled()) {
                return;
            }
            if (generations.get(tabId) !== generation) {
                return;
            }
            await dependencies.applyBadge(tabId, badge);
        });
        const tracked = mutation.finally(() => {
            if (badgeMutations.get(tabId) === tracked) {
                badgeMutations.delete(tabId);
            }
        });
        badgeMutations.set(tabId, tracked);
        return tracked;
    };

    const runUpdate = async (tabId: number, url: string): Promise<void> => {
        const generation = nextGeneration(tabId);
        const isCurrent = (): boolean => generations.get(tabId) === generation;

        await enqueueMutation(tabId, generation, EMPTY_BADGE, false);
        if (!isCurrent() || !await dependencies.isEnabled() || !isCurrent()) {
            return;
        }
        try {
            const result = await dependencies.lookup(url);
            await enqueueMutation(tabId, generation, badgeForLookupResult(result), true);
        } catch {
            await enqueueMutation(tabId, generation, EMPTY_BADGE, false);
        }
    };

    return {
        update(tabId, url) {
            const tracked = runUpdate(tabId, url);
            inFlightUpdates.add(tracked);
            void tracked.then(
                () => inFlightUpdates.delete(tracked),
                () => inFlightUpdates.delete(tracked),
            );
            return tracked;
        },

        forget(tabId) {
            nextGeneration(tabId);
            generations.delete(tabId);
        },

        async disable(tabIds) {
            const affectedTabs = new Set([
                ...generations.keys(),
                ...badgeMutations.keys(),
                ...tabIds,
            ]);
            const clearGenerations = new Map(
                [...affectedTabs].map((tabId) => [tabId, nextGeneration(tabId)]),
            );
            await Promise.allSettled([...inFlightUpdates]);
            const clears = [...clearGenerations].map(([tabId, generation]) => (
                enqueueMutation(tabId, generation, EMPTY_BADGE, false)
            ));
            await Promise.all(clears);
        },
    };
}

import { badgeForLookupResult } from './availability-badge';
import type { AvailabilityBadge } from './availability-badge';
import type { HnLookupResult } from '../domain/hn';

const EMPTY_BADGE: AvailabilityBadge = { text: '', title: 'HN Split' };

/** Defines lookup and badge operations used by the automatic updater. */
export interface AutomaticAvailabilityDependencies {
    /** Reads whether automatic availability is currently enabled. */
    isEnabled(): Promise<boolean>;
    /** Looks up Hacker News availability for one public URL. */
    lookup(url: string): Promise<HnLookupResult>;
    /** Applies validated badge state to one browser tab. */
    applyBadge(tabId: number, badge: AvailabilityBadge): Promise<void>;
}

/** Exposes lifecycle operations for automatic per-tab availability. */
export interface AutomaticAvailabilityUpdater {
    /** Updates one tab after navigation. */
    update(tabId: number, url: string): Promise<void>;
    /** Waits for pending work and clears badges for affected tabs. */
    disable(tabIds: number[]): Promise<void>;
    /** Discards queued state for a tab that no longer exists. */
    forget(tabId: number): void;
}

/** Creates a race-safe updater that serializes badge writes per tab. */
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

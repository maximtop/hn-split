import { EMPTY_AVAILABILITY_BADGE, badgeForLookupResult } from './availability-badge';
import type { AvailabilityBadge } from './availability-badge';
import { HN_LOOKUP_STATUS } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';

/**
 * Defines lookup and badge operations used by the automatic updater.
 */
export interface AutomaticAvailabilityDependencies {
    /**
     * Reads whether automatic availability is currently enabled.
     */
    isEnabled(): Promise<boolean>;
    /**
     * Looks up Hacker News availability for one public URL.
     * @param url - The eligible public article URL to inspect.
     * @param signal - The abort signal that cancels a superseded lookup.
     */
    lookup(url: string, signal: AbortSignal): Promise<HnLookupResult>;
    /**
     * Applies validated badge state to one browser tab.
     * @param tabId - The browser tab identifier that receives the badge.
     * @param badge - The validated availability badge state to apply.
     */
    applyBadge(tabId: number, badge: AvailabilityBadge): Promise<void>;
}

/**
 * Coordinates race-safe automatic lookups and serialized badge mutations.
 */
export class AutomaticAvailabilityUpdater {
    private readonly generations = new Map<number, number>();
    private readonly badgeMutations = new Map<number, Promise<void>>();
    private readonly inFlightUpdates = new Set<Promise<void>>();
    private readonly lookupControllers = new Map<number, AbortController>();
    private readonly scheduledUrls = new Map<number, string>();
    private revision = 0;

    /**
     * Creates an automatic-availability coordinator.
     * @param dependencies - The browser, lookup, and badge operations used by the updater.
     */
    constructor(private readonly dependencies: AutomaticAvailabilityDependencies) {}

    /**
     * Updates one tab after navigation, ignoring the duplicate event Chrome
     * fires when one navigation reports both a URL change and completion.
     * @param tabId - The updated browser tab identifier.
     * @param url - The navigated public URL to inspect.
     */
    update(tabId: number, url: string): Promise<void> {
        if (this.scheduledUrls.get(tabId) === url) {
            return Promise.resolve();
        }
        return this.refresh(tabId, url);
    }

    /**
     * Re-evaluates one tab even when its URL was already scheduled, as needed
     * right after the automatic mode is enabled.
     * @param tabId - The browser tab identifier to refresh.
     * @param url - The current public URL to inspect.
     */
    refresh(tabId: number, url: string): Promise<void> {
        this.scheduledUrls.set(tabId, url);
        const tracked = this.runUpdate(tabId, url);
        this.inFlightUpdates.add(tracked);
        void tracked.then(
            () => this.inFlightUpdates.delete(tracked),
            () => this.inFlightUpdates.delete(tracked),
        );
        return tracked;
    }

    /**
     * Cancels pending work and clears badges for affected tabs.
     * @param tabIds - The currently open browser tab identifiers to clear.
     */
    async disable(tabIds: number[]): Promise<void> {
        this.scheduledUrls.clear();
        const affectedTabs = new Set([
            ...this.generations.keys(),
            ...this.badgeMutations.keys(),
            ...tabIds,
        ]);
        const clearGenerations = new Map(
            [...affectedTabs].map((tabId) => [tabId, this.nextGeneration(tabId)]),
        );
        await Promise.allSettled([...this.inFlightUpdates]);
        const clears = [...clearGenerations].map(([tabId, generation]) => (
            this.enqueueMutation(tabId, generation, EMPTY_AVAILABILITY_BADGE, false)
        ));
        await Promise.all(clears);
    }

    /**
     * Discards queued state for a tab that no longer exists.
     * @param tabId - The removed browser tab identifier to forget.
     */
    forget(tabId: number): void {
        this.nextGeneration(tabId);
        this.generations.delete(tabId);
        this.scheduledUrls.delete(tabId);
    }

    private nextGeneration(tabId: number): number {
        this.revision += 1;
        const generation = this.revision;
        this.generations.set(tabId, generation);
        this.lookupControllers.get(tabId)?.abort();
        this.lookupControllers.delete(tabId);
        return generation;
    }

    private enqueueMutation(
        tabId: number,
        generation: number,
        badge: AvailabilityBadge,
        requireEnabled: boolean,
    ): Promise<void> {
        const previous = this.badgeMutations.get(tabId) ?? Promise.resolve();
        const mutation = previous.catch(() => undefined).then(async () => {
            if (this.generations.get(tabId) !== generation) {
                return;
            }
            if (requireEnabled && !await this.dependencies.isEnabled()) {
                return;
            }
            if (this.generations.get(tabId) !== generation) {
                return;
            }
            await this.dependencies.applyBadge(tabId, badge);
        });
        const tracked = mutation.finally(() => {
            if (this.badgeMutations.get(tabId) === tracked) {
                this.badgeMutations.delete(tabId);
            }
        });
        this.badgeMutations.set(tabId, tracked);
        return tracked;
    }

    private forgetScheduledUrl(tabId: number, url: string): void {
        if (this.scheduledUrls.get(tabId) === url) {
            this.scheduledUrls.delete(tabId);
        }
    }

    private async runUpdate(tabId: number, url: string): Promise<void> {
        const generation = this.nextGeneration(tabId);
        const isCurrent = (): boolean => this.generations.get(tabId) === generation;

        await this.enqueueMutation(tabId, generation, EMPTY_AVAILABILITY_BADGE, false);
        if (!isCurrent() || !await this.dependencies.isEnabled() || !isCurrent()) {
            return;
        }
        const controller = new AbortController();
        this.lookupControllers.set(tabId, controller);
        try {
            const result = await this.dependencies.lookup(url, controller.signal);
            if (result.status === HN_LOOKUP_STATUS.ERROR) {
                // Let a reload of the same URL retry after a failed lookup.
                this.forgetScheduledUrl(tabId, url);
            }
            await this.enqueueMutation(tabId, generation, badgeForLookupResult(result), true);
        } catch {
            this.forgetScheduledUrl(tabId, url);
            await this.enqueueMutation(tabId, generation, EMPTY_AVAILABILITY_BADGE, false);
        } finally {
            if (this.lookupControllers.get(tabId) === controller) {
                this.lookupControllers.delete(tabId);
            }
        }
    }
}

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
 * Suspends badge mutations while the latest tab URL is still being acquired.
 */
interface CurrentTabReservation {
    /**
     * Resolves when this URL acquisition is either completed or superseded.
     */
    completed: Promise<void>;
    /**
     * Releases mutations waiting for this URL acquisition.
     */
    complete: () => void;
}

/**
 * Coordinates race-safe automatic lookups and serialized badge mutations.
 */
export class AutomaticAvailabilityUpdater {
    private readonly generations = new Map<number, number>();
    private readonly currentTabReservations = new Map<number, CurrentTabReservation>();
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
     * Reads and processes one tab URL only while automatic availability is
     * enabled. Keeping URL acquisition behind this gate ensures the disabled
     * default does not inspect or retain navigation URLs.
     * @param tabId - The updated browser tab identifier.
     * @param readUrl - Reads the tab's current URL after the enabled gate passes.
     */
    async updateCurrentTab(
        tabId: number,
        readUrl: () => Promise<string | undefined>,
    ): Promise<void> {
        const reservation = this.reserveCurrentTabUpdate(tabId);
        try {
            const enabled = await this.dependencies.isEnabled();
            if (!enabled || !this.isCurrentTabReservation(tabId, reservation)) {
                return;
            }
            const url = await readUrl();
            if (url === undefined || !this.isCurrentTabReservation(tabId, reservation)) {
                return;
            }
            const update = this.update(tabId, url);
            this.releaseCurrentTabReservation(tabId, reservation);
            await update;
        } finally {
            this.releaseCurrentTabReservation(tabId, reservation);
        }
    }

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
        this.releaseAllCurrentTabReservations();
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
        const reservation = this.currentTabReservations.get(tabId);
        if (reservation !== undefined) {
            this.releaseCurrentTabReservation(tabId, reservation);
        }
        this.generations.delete(tabId);
        this.scheduledUrls.delete(tabId);
    }

    private reserveCurrentTabUpdate(tabId: number): CurrentTabReservation {
        this.currentTabReservations.get(tabId)?.complete();
        let complete!: () => void;
        const completed = new Promise<void>((resolve) => {
            complete = resolve;
        });
        const reservation = { completed, complete };
        this.currentTabReservations.set(tabId, reservation);
        return reservation;
    }

    private isCurrentTabReservation(tabId: number, reservation: CurrentTabReservation): boolean {
        return this.currentTabReservations.get(tabId) === reservation;
    }

    private releaseCurrentTabReservation(tabId: number, reservation: CurrentTabReservation): void {
        if (this.isCurrentTabReservation(tabId, reservation)) {
            this.currentTabReservations.delete(tabId);
        }
        reservation.complete();
    }

    private releaseAllCurrentTabReservations(): void {
        for (const reservation of this.currentTabReservations.values()) {
            reservation.complete();
        }
        this.currentTabReservations.clear();
    }

    private async waitForCurrentTabReservation(tabId: number): Promise<void> {
        let reservation = this.currentTabReservations.get(tabId);
        while (reservation !== undefined) {
            await reservation.completed;
            reservation = this.currentTabReservations.get(tabId);
        }
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
            await this.waitForCurrentTabReservation(tabId);
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

    private forgetScheduledUrl(tabId: number, url: string, generation: number): void {
        if (this.generations.get(tabId) === generation && this.scheduledUrls.get(tabId) === url) {
            this.scheduledUrls.delete(tabId);
        }
    }

    private async runUpdate(tabId: number, url: string): Promise<void> {
        const generation = this.nextGeneration(tabId);
        const isCurrent = (): boolean => this.generations.get(tabId) === generation;

        await this.enqueueMutation(tabId, generation, EMPTY_AVAILABILITY_BADGE, false);
        if (!isCurrent()) {
            return;
        }
        if (!await this.dependencies.isEnabled()) {
            this.forgetScheduledUrl(tabId, url, generation);
            return;
        }
        if (!isCurrent()) {
            return;
        }
        const controller = new AbortController();
        this.lookupControllers.set(tabId, controller);
        try {
            const result = await this.dependencies.lookup(url, controller.signal);
            if (result.status === HN_LOOKUP_STATUS.ERROR) {
                // Let a reload of the same URL retry after a failed lookup.
                this.forgetScheduledUrl(tabId, url, generation);
            }
            await this.enqueueMutation(tabId, generation, badgeForLookupResult(result), true);
        } catch {
            this.forgetScheduledUrl(tabId, url, generation);
            await this.enqueueMutation(tabId, generation, EMPTY_AVAILABILITY_BADGE, false);
        } finally {
            if (this.lookupControllers.get(tabId) === controller) {
                this.lookupControllers.delete(tabId);
            }
        }
    }
}

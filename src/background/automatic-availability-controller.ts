import { AutomaticAvailabilityUpdater } from '../browser/automatic-availability';
import {
    applyAutomaticAvailabilitySetting,
    createAutomaticAvailabilitySettingQueue,
} from '../browser/automatic-availability-lifecycle';
import { refreshTabsBounded } from '../browser/bounded-tab-refresh';
import { clearLookupCacheEntries } from '../browser/lookup-cache';
import { sanitizeArticleUrl } from '../domain/url';
import { lookupArticle } from './article-lookup';
import {
    applyAvailabilityBadge,
    cacheCollectionStorage,
    getAutomaticAvailabilityEnabled,
    setAutomaticAvailabilityEnabled,
} from './chrome-adapters';

const ENABLE_REFRESH_CONCURRENCY = 4;

const automaticAvailability = new AutomaticAvailabilityUpdater({
    isEnabled: getAutomaticAvailabilityEnabled,
    async lookup(url, signal) {
        return lookupArticle(url, null, signal);
    },
    applyBadge: applyAvailabilityBadge,
});

/**
 * Re-evaluates eligible open tabs with bounded concurrency after automatic
 * mode is enabled, and fails the enable transaction when refreshes reject.
 */
async function updateExistingTabs(): Promise<void> {
    const openTabs = await chrome.tabs.query({});
    const eligibleTabs = openTabs.flatMap((tab) => (
        tab.id === undefined || tab.url === undefined || sanitizeArticleUrl(tab.url) === null
            ? []
            : [{ tabId: tab.id, url: tab.url }]
    ));
    const failures = await refreshTabsBounded(
        eligibleTabs,
        async (tabId, url) => automaticAvailability.refresh(tabId, url),
        ENABLE_REFRESH_CONCURRENCY,
    );
    if (failures.length > 0) {
        // Counts only: the diagnostic must stay free of visited URLs.
        throw new AggregateError(
            failures,
            `Unable to refresh ${failures.length} of ${eligibleTabs.length} open tabs`,
        );
    }
}

/**
 * Disables automatic mode after draining work, badges, and derived cache records.
 */
async function disableAutomaticAvailability(): Promise<void> {
    const openTabs = await chrome.tabs.query({});
    await automaticAvailability.disable(openTabs.flatMap(({ id }) => id === undefined ? [] : [id]));
    await clearLookupCacheEntries(cacheCollectionStorage);
}

const applyAutomaticAvailabilityChange = createAutomaticAvailabilitySettingQueue(async (enabled) => {
    await applyAutomaticAvailabilitySetting(enabled, {
        getEnabled: getAutomaticAvailabilityEnabled,
        setEnabled: setAutomaticAvailabilityEnabled,
        enable: updateExistingTabs,
        disable: disableAutomaticAvailability,
    });
});

/**
 * Applies one serialized automatic-availability setting transaction.
 * @param enabled - Whether automatic availability should be enabled.
 */
export async function setAutomaticAvailability(enabled: boolean): Promise<boolean> {
    await applyAutomaticAvailabilityChange(enabled);
    return enabled;
}

/**
 * Updates automatic availability for one navigated tab.
 * @param tabId - The navigated browser tab identifier.
 * @param url - The current tab URL.
 */
export function updateAutomaticAvailability(tabId: number, url: string): Promise<void> {
    return automaticAvailability.update(tabId, url);
}

/**
 * Invalidates automatic-availability work for a removed tab.
 * @param tabId - The removed browser tab identifier.
 */
export function forgetAutomaticAvailabilityTab(tabId: number): void {
    automaticAvailability.forget(tabId);
}

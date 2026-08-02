import { AutomaticAvailabilityUpdater } from '../browser/automatic-availability';
import {
    applyAutomaticAvailabilitySetting,
    createAutomaticAvailabilitySettingQueue,
} from '../browser/automatic-availability-lifecycle';
import { clearLookupCacheEntries } from '../browser/lookup-cache';
import { lookupArticle } from './article-lookup';
import {
    applyAvailabilityBadge,
    cacheCollectionStorage,
    getAutomaticAvailabilityEnabled,
    setAutomaticAvailabilityEnabled,
} from './chrome-adapters';

const automaticAvailability = new AutomaticAvailabilityUpdater({
    isEnabled: getAutomaticAvailabilityEnabled,
    async lookup(url) {
        return lookupArticle(url, null);
    },
    applyBadge: applyAvailabilityBadge,
});

/**
 * Re-evaluates all currently open tabs after automatic mode is enabled.
 */
async function updateExistingTabs(): Promise<void> {
    const openTabs = await chrome.tabs.query({});
    await Promise.allSettled(openTabs.map(async (tab) => {
        if (tab.id === undefined) {
            return;
        }
        await automaticAvailability.update(tab.id, tab.url ?? '');
    }));
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

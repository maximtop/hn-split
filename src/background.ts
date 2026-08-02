import { createAutomaticAvailabilityUpdater } from './browser/automaticAvailability';
import {
    applyAutomaticAvailabilitySetting,
    createAutomaticAvailabilitySettingQueue,
} from './browser/automaticAvailabilityLifecycle';
import type { AvailabilityBadge } from './browser/availabilityBadge';
import { clearLookupCacheEntries, lookupWithCache } from './browser/lookupCache';
import type { CacheStorage } from './browser/lookupCache';
import { openDiscussion } from './browser/openDiscussion';
import type { SessionStore, TabClient, TabSummary } from './browser/openDiscussion';
import { lookupHnDiscussions } from './domain/hn';
import { buildArticleCandidates } from './domain/url';
import { isBackgroundRequest } from './shared/messages';
import type { BackgroundRequest, BackgroundResponse } from './shared/messages';

const toTabSummary = (tab: chrome.tabs.Tab): TabSummary => ({
    ...(tab.id === undefined ? {} : { id: tab.id }),
    index: tab.index,
    windowId: tab.windowId,
    ...(tab.splitViewId === undefined ? {} : { splitViewId: tab.splitViewId }),
});

const tabs: TabClient = {
    async get(tabId) {
        return toTabSummary(await chrome.tabs.get(tabId));
    },
    async create(properties) {
        return toTabSummary(await chrome.tabs.create(properties));
    },
    async update(tabId, properties) {
        const tab = await chrome.tabs.update(tabId, properties);
        if (tab === undefined) {
            throw new Error('Chrome did not return the updated discussion tab');
        }
        return toTabSummary(tab);
    },
};

const sessionStore: SessionStore = {
    async get(articleTabId) {
        const key = `discussion_tab:${articleTabId}`;
        const stored = await chrome.storage.session.get(key);
        return typeof stored[key] === 'number' ? stored[key] : undefined;
    },
    async set(articleTabId, discussionTabId) {
        await chrome.storage.session.set({ [`discussion_tab:${articleTabId}`]: discussionTabId });
    },
    async remove(articleTabId) {
        await chrome.storage.session.remove(`discussion_tab:${articleTabId}`);
    },
};

const AUTOMATIC_AVAILABILITY_KEY = 'automatic_availability';

const cacheStorage: CacheStorage = {
    async get(key) {
        return (await chrome.storage.session.get(key))[key];
    },
    async set(key, value) {
        await chrome.storage.session.set({ [key]: value });
    },
    async remove(key) {
        await chrome.storage.session.remove(key);
    },
};

const cacheCollectionStorage = {
    async getAll(): Promise<Record<string, unknown>> {
        return chrome.storage.session.get(null);
    },
    async remove(keys: string[]): Promise<void> {
        await chrome.storage.session.remove(keys);
    },
};

async function lookupArticle(pageUrl: string, canonicalHref: string | null) {
    const candidates = buildArticleCandidates(pageUrl, canonicalHref);
    return lookupWithCache(
        candidates,
        cacheStorage,
        async () => lookupHnDiscussions(candidates),
    );
}

async function applyAvailabilityBadge(tabId: number, badge: AvailabilityBadge): Promise<void> {
    try {
        await chrome.action.setBadgeText({ tabId, text: badge.text });
        if (badge.color !== undefined) {
            await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
        }
        await chrome.action.setTitle({ tabId, title: badge.title });
    } catch (error) {
        try {
            await chrome.tabs.get(tabId);
        } catch {
            return;
        }
        throw error;
    }
}

const automaticAvailability = createAutomaticAvailabilityUpdater({
    async isEnabled() {
        const stored = await chrome.storage.local.get(AUTOMATIC_AVAILABILITY_KEY);
        return stored[AUTOMATIC_AVAILABILITY_KEY] === true;
    },
    async lookup(url) {
        return lookupArticle(url, null);
    },
    applyBadge: applyAvailabilityBadge,
});

async function updateExistingTabs(): Promise<void> {
    const openTabs = await chrome.tabs.query({});
    await Promise.allSettled(openTabs.map(async (tab) => {
        if (tab.id === undefined) {
            return;
        }
        await automaticAvailability.update(tab.id, tab.url ?? '');
    }));
}

async function disableAutomaticAvailability(): Promise<void> {
    const openTabs = await chrome.tabs.query({});
    await automaticAvailability.disable(openTabs.flatMap(({ id }) => id === undefined ? [] : [id]));
    await clearLookupCacheEntries(cacheCollectionStorage);
}

const applyAutomaticAvailabilityChange = createAutomaticAvailabilitySettingQueue(async (enabled) => {
    await applyAutomaticAvailabilitySetting(enabled, {
        async getEnabled() {
            const stored = await chrome.storage.local.get(AUTOMATIC_AVAILABILITY_KEY);
            return stored[AUTOMATIC_AVAILABILITY_KEY] === true;
        },
        async setEnabled(value) {
            await chrome.storage.local.set({ [AUTOMATIC_AVAILABILITY_KEY]: value });
        },
        enable: updateExistingTabs,
        disable: disableAutomaticAvailability,
    });
});

async function handleRequest(request: BackgroundRequest): Promise<BackgroundResponse> {
    try {
        if (request.type === 'lookup') {
            const result = await lookupArticle(
                request.context.pageUrl,
                request.context.canonicalHref,
            );
            return { ok: true, result };
        }

        if (request.type === 'availability_setting_changed') {
            await applyAutomaticAvailabilityChange(request.enabled);
            return { ok: true, result: { status: 'updated' } };
        }

        const result = await openDiscussion(
            request.articleTabId,
            request.itemId,
            tabs,
            sessionStore,
        );
        return { ok: true, result };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unexpected extension error',
        };
    }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isBackgroundRequest(message)) {
        return false;
    }
    void handleRequest(message).then(sendResponse);
    return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? (changeInfo.status === 'complete' ? tab.url : undefined);
    if (url === undefined) {
        return;
    }
    void automaticAvailability.update(tabId, url).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    automaticAvailability.forget(tabId);
    void sessionStore.remove(tabId).catch(() => undefined);
});

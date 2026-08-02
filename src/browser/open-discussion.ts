import { discussionUrl } from '../domain/hn';

/** Describes the tab fields needed for discussion placement and reuse. */
export interface TabSummary {
    /** Contains the optional browser tab identifier. */
    id?: number;
    /** Contains the tab index within its window. */
    index: number;
    /** Contains the owning browser window identifier. */
    windowId: number;
    /** Contains Chrome's Split View identifier when available. */
    splitViewId?: number;
}

/** Defines the browser tab operations used by discussion opening. */
export interface TabClient {
    /** Reads one browser tab. */
    get(tabId: number): Promise<TabSummary>;
    /** Creates one adjacent browser tab. */
    create(properties: {
        active: boolean;
        index: number;
        openerTabId: number;
        url: string;
        windowId: number;
    }): Promise<TabSummary>;
    /** Navigates and activates an existing browser tab. */
    update(tabId: number, properties: { active: boolean; url: string }): Promise<TabSummary> | void;
}

/** Defines session-only article-to-discussion tab associations. */
export interface SessionStore {
    /** Reads the remembered discussion tab for an article tab. */
    get(articleTabId: number): Promise<number | undefined>;
    /** Remembers a discussion tab for an article tab. */
    set(articleTabId: number, discussionTabId: number): Promise<void>;
    /** Removes a stale article-to-discussion association. */
    remove(articleTabId: number): Promise<void>;
}

/** Describes how and where a discussion tab was opened. */
export type OpenDiscussionResult = {
    mode: 'adjacent_tab' | 'reused_tab' | 'split_view';
    tabId: number;
};

const isSameSplitView = (article: TabSummary, discussion: TabSummary): boolean => (
    article.splitViewId !== undefined
    && article.splitViewId !== -1
    && article.splitViewId === discussion.splitViewId
);

const pendingOpens = new Map<number, Promise<void>>();

/** Performs one serialized discussion open or reuse operation. */
async function performOpenDiscussion(
    articleTabId: number,
    itemId: string,
    tabs: TabClient,
    store: SessionStore,
): Promise<OpenDiscussionResult> {
    const article = await tabs.get(articleTabId);
    const url = discussionUrl(itemId);
    const rememberedTabId = await store.get(articleTabId);

    if (rememberedTabId !== undefined) {
        let rememberedTab: TabSummary | undefined;
        try {
            rememberedTab = await tabs.get(rememberedTabId);
        } catch {
            // The user closed the remembered tab. Create a new adjacent tab below.
        }
        if (rememberedTab !== undefined && rememberedTab.windowId === article.windowId) {
            await tabs.update(rememberedTabId, { active: true, url });
            return {
                mode: isSameSplitView(article, rememberedTab) ? 'split_view' : 'reused_tab',
                tabId: rememberedTabId,
            };
        }
        await store.remove(articleTabId);
    }

    const created = await tabs.create({
        active: true,
        index: article.index + 1,
        openerTabId: articleTabId,
        url,
        windowId: article.windowId,
    });
    if (created.id === undefined) {
        throw new Error('Chrome did not return an ID for the discussion tab');
    }
    await store.set(articleTabId, created.id);
    return { mode: 'adjacent_tab', tabId: created.id };
}

/** Opens or reuses one discussion tab while serializing requests per article tab. */
export async function openDiscussion(
    articleTabId: number,
    itemId: string,
    tabs: TabClient,
    store: SessionStore,
): Promise<OpenDiscussionResult> {
    const previous = pendingOpens.get(articleTabId) ?? Promise.resolve();
    let release = (): void => undefined;
    const turn = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = previous.catch(() => undefined).then(async () => turn);
    pendingOpens.set(articleTabId, pending);

    await previous.catch(() => undefined);
    try {
        return await performOpenDiscussion(articleTabId, itemId, tabs, store);
    } finally {
        release();
        if (pendingOpens.get(articleTabId) === pending) {
            pendingOpens.delete(articleTabId);
        }
    }
}

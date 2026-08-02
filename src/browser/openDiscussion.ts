import { discussionUrl } from '../domain/hn';

export interface TabSummary {
    id?: number;
    index: number;
    windowId: number;
    splitViewId?: number;
}

export interface TabClient {
    get(tabId: number): Promise<TabSummary>;
    create(properties: {
        active: boolean;
        index: number;
        openerTabId: number;
        url: string;
        windowId: number;
    }): Promise<TabSummary>;
    update(tabId: number, properties: { active: boolean; url: string }): Promise<TabSummary> | void;
}

export interface SessionStore {
    get(articleTabId: number): Promise<number | undefined>;
    set(articleTabId: number, discussionTabId: number): Promise<void>;
    remove(articleTabId: number): Promise<void>;
}

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

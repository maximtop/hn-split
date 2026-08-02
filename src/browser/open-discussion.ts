import { discussionUrl } from '../domain/hn';
import { DISCUSSION_OPEN_MODE } from '../shared/messages';
import type { OpenDiscussionResult } from '../shared/messages';

/**
 * Describes the tab fields needed for discussion placement and reuse.
 */
export interface TabSummary {
    /**
     * Contains the optional browser tab identifier.
     */
    id?: number;
    /**
     * Contains the tab index within its window.
     */
    index: number;
    /**
     * Contains the owning browser window identifier.
     */
    windowId: number;
    /**
     * Contains Chrome's Split View identifier when available.
     */
    splitViewId?: number;
}

/**
 * Defines the browser tab operations used by discussion opening.
 */
export interface TabClient {
    /**
     * Reads one browser tab.
     * @param tabId - The browser tab identifier to read.
     */
    get(tabId: number): Promise<TabSummary>;
    /**
     * Creates one adjacent browser tab.
     * @param properties - The placement, opener, and URL for the new tab.
     */
    create(properties: {
        active: boolean;
        index: number;
        openerTabId: number;
        url: string;
        windowId: number;
    }): Promise<TabSummary>;
    /**
     * Navigates and activates an existing browser tab.
     * @param tabId - The browser tab identifier to update.
     * @param properties - The active state and URL to apply.
     */
    update(tabId: number, properties: { active: boolean; url: string }): Promise<TabSummary> | void;
}

/**
 * Defines session-only article-to-discussion tab associations.
 */
export interface SessionStore {
    /**
     * Reads the remembered discussion tab for an article tab.
     * @param articleTabId - The source article tab identifier.
     */
    get(articleTabId: number): Promise<number | undefined>;
    /**
     * Remembers a discussion tab for an article tab.
     * @param articleTabId - The source article tab identifier.
     * @param discussionTabId - The associated discussion tab identifier.
     */
    set(articleTabId: number, discussionTabId: number): Promise<void>;
    /**
     * Removes a stale article-to-discussion association.
     * @param articleTabId - The source article tab identifier to forget.
     */
    remove(articleTabId: number): Promise<void>;
}

/**
 * Serializes discussion opens per article tab and owns tab-reuse state transitions.
 */
export class DiscussionTabManager {
    private readonly pendingOpens = new Map<number, Promise<void>>();

    /**
     * Creates a discussion-tab manager.
     * @param tabs - The Chrome tabs adapter used to query, update, or create tabs.
     * @param store - The session store that tracks article-to-discussion associations.
     */
    constructor(
        private readonly tabs: TabClient,
        private readonly store: SessionStore,
    ) {}

    /**
     * Opens or reuses one discussion tab while serializing requests per article tab.
     * @param articleTabId - The source article tab identifier.
     * @param itemId - The Hacker News discussion item identifier.
     */
    async open(articleTabId: number, itemId: string): Promise<OpenDiscussionResult> {
        const previous = this.pendingOpens.get(articleTabId) ?? Promise.resolve();
        let release = (): void => undefined;
        const turn = new Promise<void>((resolve) => {
            release = resolve;
        });
        const pending = previous.catch(() => undefined).then(async () => turn);
        this.pendingOpens.set(articleTabId, pending);

        await previous.catch(() => undefined);
        try {
            return await this.performOpen(articleTabId, itemId);
        } finally {
            release();
            if (this.pendingOpens.get(articleTabId) === pending) {
                this.pendingOpens.delete(articleTabId);
            }
        }
    }

    private isSameSplitView(article: TabSummary, discussion: TabSummary): boolean {
        return article.splitViewId !== undefined
            && article.splitViewId !== -1
            && article.splitViewId === discussion.splitViewId;
    }

    private async performOpen(articleTabId: number, itemId: string): Promise<OpenDiscussionResult> {
        const article = await this.tabs.get(articleTabId);
        const url = discussionUrl(itemId);
        const rememberedTabId = await this.store.get(articleTabId);

        if (rememberedTabId !== undefined) {
            let rememberedTab: TabSummary | undefined;
            try {
                rememberedTab = await this.tabs.get(rememberedTabId);
            } catch {
                // The user closed the remembered tab. Create a new adjacent tab below.
            }
            if (rememberedTab !== undefined && rememberedTab.windowId === article.windowId) {
                await this.tabs.update(rememberedTabId, { active: true, url });
                return {
                    mode: this.isSameSplitView(article, rememberedTab)
                        ? DISCUSSION_OPEN_MODE.SPLIT_VIEW
                        : DISCUSSION_OPEN_MODE.REUSED_TAB,
                    tabId: rememberedTabId,
                };
            }
            await this.store.remove(articleTabId);
        }

        const created = await this.tabs.create({
            active: true,
            index: article.index + 1,
            openerTabId: articleTabId,
            url,
            windowId: article.windowId,
        });
        if (created.id === undefined) {
            throw new Error('Chrome did not return an ID for the discussion tab');
        }
        await this.store.set(articleTabId, created.id);
        return { mode: DISCUSSION_OPEN_MODE.ADJACENT_TAB, tabId: created.id };
    }
}

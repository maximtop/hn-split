/**
 * @file Opens a Hacker News discussion in native Split View when available, with adjacent-tab fallback,
 * remembered discussion reuse, and per-article serialization.
 */

import { discussionUrl, isHnUrl } from '../domain/hn';
import { DIAGNOSTIC_EVENT } from '../shared/diagnostic-events';
import { logWarning } from '../shared/logger';
import { DISCUSSION_OPEN_MODE } from '../shared/messages';

import type { OpenDiscussionResult } from '../shared/messages';

const NO_SPLIT_VIEW_ID = -1;

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

    /**
     * Contains the tab's committed URL when Chrome reports one.
     */
    url?: string;
}

/**
 * Defines the browser tab operations used by discussion opening.
 */
export interface TabClient {
    /**
     * Reads one browser tab.
     *
     * @param tabId - The browser tab identifier to read.
     */
    get(tabId: number): Promise<TabSummary>;

    /**
     * Creates one adjacent browser tab.
     *
     * @param properties - The placement, opener, and URL for the new tab.
     * @param properties.active - Whether the new tab becomes the active tab.
     * @param properties.index - The position of the new tab within its window.
     * @param properties.openerTabId - The article tab that opens the new tab.
     * @param properties.url - The discussion URL the new tab loads.
     * @param properties.windowId - The browser window that receives the new tab.
     * @param properties.splitWithTabId - The optional article to pair with using native Split View.
     */
    create(properties: {
        /**
         * Indicates whether the new tab becomes the active tab.
         */
        active: boolean;

        /**
         * Contains the position of the new tab within its window.
         */
        index: number;

        /**
         * Identifies the article tab that opens the new tab.
         */
        openerTabId: number;

        /**
         * Contains the discussion URL the new tab loads.
         */
        url: string;

        /**
         * Identifies the browser window that receives the new tab.
         */
        windowId: number;

        /**
         * Identifies the article to pair with when native Split View is available.
         */
        splitWithTabId?: number;
    }): Promise<TabSummary>;

    /**
     * Exposes the browser capability that gates splitWithTabId (Chrome 155+).
     * Remembered discussions are never re-paired automatically.
     *
     * @param tabIds - The article and discussion tab identifiers.
     */
    createSplit?: ((tabIds: [number, number]) => Promise<number>) | undefined;

    /**
     * Navigates and activates an existing browser tab, resolving only after
     * the browser accepts the navigation.
     *
     * @param tabId - The browser tab identifier to update.
     * @param properties - The active state and URL to apply.
     * @param properties.active - Whether the tab becomes the active tab.
     * @param properties.url - The discussion URL the tab navigates to.
     */
    update(tabId: number, properties: {
        /**
         * Indicates whether the tab becomes the active tab.
         */
        active: boolean;

        /**
         * Contains the discussion URL the tab navigates to.
         */
        url: string;
    }): Promise<TabSummary>;
}

/**
 * Defines session-only article-to-discussion tab associations.
 */
export interface SessionStore {
    /**
     * Reads the remembered discussion tab for an article tab.
     *
     * @param articleTabId - The source article tab identifier.
     */
    get(articleTabId: number): Promise<number | undefined>;

    /**
     * Remembers a discussion tab for an article tab.
     *
     * @param articleTabId - The source article tab identifier.
     * @param discussionTabId - The associated discussion tab identifier.
     */
    set(articleTabId: number, discussionTabId: number): Promise<void>;

    /**
     * Removes a stale article-to-discussion association.
     *
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
     *
     * @param tabs - The Chrome tabs adapter used to query, update, or create tabs.
     * @param store - The session store that tracks article-to-discussion associations.
     */
    constructor(
        private readonly tabs: TabClient,
        private readonly store: SessionStore,
    ) {}

    /**
     * Opens or reuses one discussion tab while serializing requests per article tab.
     *
     * @param articleTabId - The source article tab identifier.
     * @param itemId - The Hacker News discussion item identifier.
     */
    async open(articleTabId: number, itemId: string): Promise<OpenDiscussionResult> {
        const previous = this.pendingOpens.get(articleTabId) ?? Promise.resolve();
        let release = (): void => {
            return undefined;
        };
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

    /**
     * Reports whether a tab already belongs to a native Split View.
     *
     * @param tab - The tab whose pairing is checked.
     */
    private hasSplitView(tab: TabSummary): boolean {
        return tab.splitViewId !== undefined && tab.splitViewId !== NO_SPLIT_VIEW_ID;
    }

    /**
     * Determines whether two tabs are paired in the same native Split View.
     *
     * @param article - The article tab.
     * @param discussion - The discussion tab to compare against it.
     */
    private isSameSplitView(article: TabSummary, discussion: TabSummary): boolean {
        return this.hasSplitView(article)
            && article.splitViewId === discussion.splitViewId;
    }

    /**
     * Determines whether the remembered tab still serves as the discussion
     * pane. A tab that stayed on Hacker News keeps that role, and a native
     * Split View pairing with the article is the user's standing request to
     * keep the pane regardless of where they navigated it. Any other
     * navigation means the user repurposed the tab, and navigating it back
     * would take the tab over instead of serving it.
     *
     * @param article - The article tab the pane belongs to.
     * @param discussion - The remembered discussion tab to evaluate.
     */
    private isStillDiscussionPane(article: TabSummary, discussion: TabSummary): boolean {
        return this.isSameSplitView(article, discussion)
            || (discussion.url !== undefined && isHnUrl(discussion.url));
    }

    /**
     * Reuses the remembered discussion tab when it still serves as the pane in
     * the article's window, and otherwise creates a new tab next to the article
     * and remembers it. A failure to store the association does not fail the
     * open, because the discussion tab is already visible.
     *
     * @param articleTabId - The source article tab identifier.
     * @param itemId - The Hacker News discussion item identifier.
     *
     * @throws When Chrome creates the discussion tab without returning its identifier.
     */
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
            if (rememberedTab !== undefined
                && rememberedTab.windowId === article.windowId
                && this.isStillDiscussionPane(article, rememberedTab)) {
                await this.tabs.update(rememberedTabId, { active: true, url });
                // Preserve the user's layout, including an explicit Unsplit. Only a newly
                // created discussion tab opts into native pairing; reuse only navigates.
                return {
                    mode: this.isSameSplitView(article, rememberedTab)
                        ? DISCUSSION_OPEN_MODE.SPLIT_VIEW
                        : DISCUSSION_OPEN_MODE.REUSED_TAB,
                    tabId: rememberedTabId,
                };
            }
            try {
                await this.store.remove(articleTabId);
            } catch {
                // The association is overwritten or re-validated on the next open.
            }
        }

        const properties = {
            active: true,
            index: article.index + 1,
            openerTabId: articleTabId,
            url,
            windowId: article.windowId,
        };
        let created: TabSummary | undefined;
        if (!this.hasSplitView(article) && this.tabs.createSplit !== undefined) {
            try {
                created = await this.tabs.create({ ...properties, splitWithTabId: articleTabId });
            } catch (error) {
                // Older or restricted browser implementations retain the adjacent-tab flow.
                logWarning(DIAGNOSTIC_EVENT.NATIVE_SPLIT_CREATION_FAILED, error);
            }
        }
        created ??= await this.tabs.create(properties);
        if (created.id === undefined) {
            throw new Error('Chrome did not return an ID for the discussion tab');
        }
        try {
            await this.store.set(articleTabId, created.id);
        } catch {
            // The discussion tab is already visible, so the open succeeded;
            // losing the association only downgrades the next open to a new tab.
        }
        return {
            mode: this.hasSplitView(created) ? DISCUSSION_OPEN_MODE.SPLIT_VIEW : DISCUSSION_OPEN_MODE.ADJACENT_TAB,
            tabId: created.id,
        };
    }
}

import type { HnLookupResult } from '../domain/hn';
import { SIDE_PANEL_CONTENT_KIND } from '../shared/side-panel-content';
import type { SidePanelContent } from '../shared/side-panel-content';
import { SidePanelContentManager } from './side-panel-content-manager';

/**
 * Describes one window's stored side panel selection.
 */
export interface SidePanelWindowContent {
    /**
     * Contains the browser window the selection belongs to.
     */
    windowId: number;
    /**
     * Contains the panel content stored for that window.
     */
    content: SidePanelContent;
}

/**
 * Defines the operations used to route panel content to per-window stores.
 */
export interface SidePanelContentRouterDependencies {
    /**
     * Opens the side panel for one tab. Chrome honors the click's user gesture
     * only while the listener runs synchronously, so this must be the first
     * asynchronous operation started, never awaited behind another.
     * @param tabId - The browser tab whose window shows the panel.
     */
    openSidePanel(tabId: number): Promise<void>;
    /**
     * Navigates one tab to the URL the user asked to open.
     * @param tabId - The browser tab to navigate.
     * @param url - The link URL to load.
     */
    navigate(tabId: number, url: string): Promise<void>;
    /**
     * Reads what one window's side panel is currently asked to display.
     * @param windowId - The browser window whose selection is read.
     */
    readContent(windowId: number): Promise<SidePanelContent | null>;
    /**
     * Records what one window's side panel should display.
     * @param windowId - The browser window whose selection is written.
     * @param content - The panel content to record.
     */
    writeContent(windowId: number, content: SidePanelContent): Promise<void>;
    /**
     * Removes one window's stored selection.
     * @param windowId - The browser window whose selection is removed.
     */
    removeContent(windowId: number): Promise<void>;
    /**
     * Lists every window's stored selection.
     */
    listContent(): Promise<SidePanelWindowContent[]>;
    /**
     * Resolves the Hacker News discussion for one link URL.
     * @param url - The link URL to resolve.
     * @param signal - The signal that cancels a superseded lookup.
     */
    lookup(url: string, signal: AbortSignal): Promise<HnLookupResult>;
    /**
     * Reports a non-fatal failure without surfacing it to any page.
     * @param message - The stable diagnostic text.
     * @param error - The underlying failure.
     */
    warn(message: string, error: unknown): void;
}

/**
 * Routes every entry point to the selection owner of the window it targets.
 *
 * Chrome shows one side panel per window, so the selection is scoped the same
 * way: each window gets its own {@link SidePanelContentManager}, and "the
 * newest explicit action wins" applies within a window instead of letting one
 * window's click silently replace what another window's panel is showing.
 */
export class SidePanelContentRouter {
    private readonly managers = new Map<number, SidePanelContentManager>();

    /**
     * Creates the router with no per-window owner instantiated yet.
     * @param dependencies - The panel, tab, storage, and lookup operations to use.
     */
    constructor(private readonly dependencies: SidePanelContentRouterDependencies) {}

    /**
     * Reacts to one "Open in Split" link selection in one window.
     * @param linkUrl - The link URL the context menu was invoked on.
     * @param tabId - The browser tab that showed the context menu.
     * @param windowId - The browser window that tab belongs to.
     */
    openLink(linkUrl: string, tabId: number, windowId: number): void {
        this.managerFor(windowId).openLink(linkUrl, tabId);
    }

    /**
     * Displays one already known discussion in one window's panel.
     * @param itemId - The validated Hacker News item identifier to display.
     * @param windowId - The browser window whose panel shows the discussion.
     */
    async showDiscussion(itemId: string, windowId: number): Promise<SidePanelContent> {
        return this.managerFor(windowId).showDiscussion(itemId);
    }

    /**
     * Clears pending states left behind by a worker that stopped mid-lookup,
     * across every window that has a stored selection. Runs on worker start.
     */
    async normalizeStartupContent(): Promise<void> {
        const entries = await this.dependencies.listContent();
        await Promise.all(entries
            .filter(({ content }) => content.kind === SIDE_PANEL_CONTENT_KIND.PENDING)
            .map(async ({ windowId }) => this.managerFor(windowId).normalizeStartupContent()));
    }

    /**
     * Discards one closed window's selection and its in-flight work, so a
     * lookup finishing after the window closed cannot recreate the entry.
     * @param windowId - The browser window that was closed.
     */
    async forgetWindow(windowId: number): Promise<void> {
        this.managers.get(windowId)?.discard();
        this.managers.delete(windowId);
        await this.dependencies.removeContent(windowId);
    }

    /**
     * Returns the selection owner for one window, creating it on first use.
     * The lookup stays synchronous so a caller inside a user gesture reaches
     * `chrome.sidePanel.open` before its first await.
     * @param windowId - The browser window whose owner is resolved.
     */
    private managerFor(windowId: number): SidePanelContentManager {
        const existing = this.managers.get(windowId);
        if (existing !== undefined) {
            return existing;
        }
        const { dependencies } = this;
        const manager = new SidePanelContentManager({
            openSidePanel: async (tabId) => dependencies.openSidePanel(tabId),
            navigate: async (tabId, url) => dependencies.navigate(tabId, url),
            readContent: async () => dependencies.readContent(windowId),
            writeContent: async (content) => dependencies.writeContent(windowId, content),
            lookup: async (url, signal) => dependencies.lookup(url, signal),
            warn: (message, error) => {
                dependencies.warn(message, error);
            },
        });
        this.managers.set(windowId, manager);
        return manager;
    }
}

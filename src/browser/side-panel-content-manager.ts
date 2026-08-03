import { HN_LOOKUP_ERROR_REASON, HN_LOOKUP_STATUS } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import { isWebUrl } from '../domain/url';
import { SIDE_PANEL_CONTENT_KIND, contentForLookupResult } from '../shared/side-panel-content';
import type { SidePanelContent } from '../shared/side-panel-content';

/**
 * Defines the operations used to drive what the side panel displays.
 */
export interface SidePanelContentDependencies {
    /**
     * Opens the side panel for one tab. Chrome honors the context-menu click's
     * user gesture only while the listener runs synchronously, so this must be
     * the first asynchronous operation started, never awaited behind another.
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
     * Reads what the side panel is currently asked to display.
     */
    readContent(): Promise<SidePanelContent | null>;
    /**
     * Records what the side panel should display.
     * @param content - The panel content to record.
     */
    writeContent(content: SidePanelContent): Promise<void>;
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
 * Owns the single side panel selection shared by every entry point.
 *
 * The panel displays one thing at a time, so a newer request must always win:
 * each request takes the next generation, cancels the lookup of the previous
 * one, and writes only while it is still the current generation. Writes are
 * queued and re-check that generation as they run, so a slow lookup can never
 * overwrite a discussion the user picked while it was in flight.
 */
export class SidePanelContentManager {
    private readonly dependencies: SidePanelContentDependencies;

    private generation = 0;

    private controller: AbortController | null = null;

    private queue: Promise<void> = Promise.resolve();

    /**
     * Creates the manager with no request in flight.
     * @param dependencies - The panel, tab, storage, and lookup operations to use.
     */
    constructor(dependencies: SidePanelContentDependencies) {
        this.dependencies = dependencies;
    }

    /**
     * Reacts to one "Open in Split" link selection: opens the panel while the
     * click's user gesture is still valid, loads the link in the tab the user
     * clicked in, and fills the panel with the discussion once it resolves.
     *
     * Replacing the tab's page is the action the user explicitly asked for by
     * choosing this menu item; nothing happens before that selection.
     * @param linkUrl - The link URL the context menu was invoked on.
     * @param tabId - The browser tab that showed the context menu.
     */
    openLink(linkUrl: string, tabId: number): void {
        const generation = this.beginRequest();
        const controller = new AbortController();
        this.controller = controller;
        void this.dependencies.openSidePanel(tabId).catch((error: unknown) => {
            this.dependencies.warn('opening the side panel for a link selection failed.', error);
        });
        void this.resolveLink(linkUrl, tabId, generation, controller.signal)
            .catch((error: unknown) => {
                this.dependencies.warn('resolving the selected link failed.', error);
            });
    }

    /**
     * Displays one already known discussion, superseding any lookup in flight.
     * @param itemId - The validated Hacker News item identifier to display.
     */
    async showDiscussion(itemId: string): Promise<SidePanelContent> {
        const generation = this.beginRequest();
        const content: SidePanelContent = { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId };
        await this.write(generation, content);
        return content;
    }

    /**
     * Clears a pending state left behind by a worker that stopped mid-lookup,
     * so a panel opened later never waits for a result that will never arrive.
     * Runs on worker start and yields to any request that already began.
     */
    async normalizeStartupContent(): Promise<void> {
        const generation = this.generation;
        const content = await this.dependencies.readContent();
        if (content?.kind !== SIDE_PANEL_CONTENT_KIND.PENDING) {
            return;
        }
        await this.write(generation, {
            kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
            reason: HN_LOOKUP_STATUS.ERROR,
        });
    }

    /**
     * Takes the next generation and cancels the lookup it supersedes.
     */
    private beginRequest(): number {
        this.controller?.abort();
        this.controller = null;
        this.generation += 1;
        return this.generation;
    }

    /**
     * Navigates the tab and resolves the discussion for one link selection.
     * @param linkUrl - The link URL the context menu was invoked on.
     * @param tabId - The browser tab that showed the context menu.
     * @param generation - The request generation this run belongs to.
     * @param signal - The signal that cancels this run's lookup.
     */
    private async resolveLink(
        linkUrl: string,
        tabId: number,
        generation: number,
        signal: AbortSignal,
    ): Promise<void> {
        await this.write(generation, { kind: SIDE_PANEL_CONTENT_KIND.PENDING });
        if (isWebUrl(linkUrl)) {
            try {
                await this.dependencies.navigate(tabId, linkUrl);
            } catch (error) {
                // The tab can be closed or replaced between the click and this
                // point; the lookup still has somewhere to report its result.
                this.dependencies.warn('navigating to the selected link failed.', error);
            }
        }
        let result: HnLookupResult;
        try {
            result = await this.dependencies.lookup(linkUrl, signal);
        } catch (error) {
            this.dependencies.warn('looking up the selected link failed.', error);
            result = { status: HN_LOOKUP_STATUS.ERROR, reason: HN_LOOKUP_ERROR_REASON.LOOKUP_FAILED };
        }
        await this.write(generation, contentForLookupResult(result));
    }

    /**
     * Queues one write that applies only while its request is still current.
     * @param generation - The request generation the content belongs to.
     * @param content - The panel content to record.
     */
    private async write(generation: number, content: SidePanelContent): Promise<void> {
        const step = async (): Promise<void> => {
            if (generation !== this.generation) {
                return;
            }
            await this.dependencies.writeContent(content);
        };
        this.queue = this.queue.then(step, step);
        await this.queue;
    }
}

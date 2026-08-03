/**
 * Describes the message-sender fields used to validate one article click.
 */
export interface ArticleClickSender {
    /**
     * Contains the browser tab the click message came from, when known.
     */
    tabId?: number;
    /**
     * Contains the origin of the sending document, when Chrome reports one.
     */
    origin?: string;
}

/**
 * Defines the operations used to answer one article-click message.
 */
export interface ArticleClickOpenDependencies {
    /**
     * Returns the in-memory setting value, or undefined before the worker has
     * read it from storage.
     */
    cachedEnabled(): boolean | undefined;
    /**
     * Reads the authoritative persisted setting.
     */
    readEnabled(): Promise<boolean>;
    /**
     * Opens the side panel for the clicking tab. Chrome honors the click's
     * user gesture only while the message listener runs synchronously, so
     * this must be the first asynchronous operation started, never awaited
     * behind another one.
     * @param tabId - The browser tab whose window shows the panel.
     */
    openSidePanel(tabId: number): Promise<void>;
    /**
     * Records the discussion the side panel should display.
     * @param itemId - The validated Hacker News item identifier.
     */
    setSelection(itemId: string): Promise<void>;
    /**
     * Reports a non-fatal failure without exposing it to the page.
     * @param message - The stable diagnostic text.
     * @param error - The underlying failure.
     */
    warn(message: string, error: unknown): void;
}

/**
 * Reacts to one story-link click reported by the Hacker News content script:
 * opens the side panel synchronously while the user gesture is valid, then
 * records the clicked discussion once the setting is confirmed enabled.
 *
 * When the worker was just woken by this very message the cached setting is
 * still unknown; the registration itself then acts as the gate (the script
 * only exists while the setting is on), and the selection write stays behind
 * the authoritative storage read.
 * @param itemId - The validated Hacker News item identifier that was clicked.
 * @param sender - The runtime message sender to validate.
 * @param expectedOrigin - The only document origin allowed to report clicks.
 * @param dependencies - The setting, panel, and selection operations to use.
 */
export function respondToArticleClick(
    itemId: string,
    sender: ArticleClickSender,
    expectedOrigin: string,
    dependencies: ArticleClickOpenDependencies,
): void {
    const { tabId } = sender;
    if (tabId === undefined || sender.origin !== expectedOrigin) {
        return;
    }
    const cached = dependencies.cachedEnabled();
    if (cached === false) {
        return;
    }
    void dependencies.openSidePanel(tabId).catch((error: unknown) => {
        dependencies.warn('opening the side panel for a story click failed.', error);
    });
    void (async () => {
        const enabled = cached ?? await dependencies.readEnabled();
        if (enabled) {
            await dependencies.setSelection(itemId);
        }
    })().catch((error: unknown) => {
        dependencies.warn('recording the clicked discussion failed.', error);
    });
}

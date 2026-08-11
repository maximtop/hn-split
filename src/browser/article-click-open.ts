import type {
    ExpectedNavigationReservation,
    ExplicitOperationReservation,
    ShowDiscussionOptions,
} from './side-panel-content-manager';
import { FOLLOW_DIAGNOSTIC_CODE } from '../shared/logger';
import type { FollowWarningSink } from '../shared/logger';

/**
 * Describes the message-sender fields used to validate one article click.
 */
export interface ArticleClickSender {
    /**
     * Contains the browser tab the click message came from, when known.
     */
    tabId?: number;
    /**
     * Contains the browser window that tab belongs to, when known.
     */
    windowId?: number;
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
     * Reserves the source tab's exact article navigation synchronously.
     * @param tabId - The source Hacker News tab.
     * @param windowId - The source tab's browser window.
     * @param articleUrl - The exact clicked story target.
     */
    reserveExpectedNavigation(
        tabId: number,
        windowId: number,
        articleUrl: string,
    ): ExpectedNavigationReservation;
    /**
     * Reserves explicit projection precedence synchronously.
     * @param tabId - The source Hacker News tab.
     * @param windowId - The source tab's browser window.
     */
    reserveExplicitOperation(tabId: number, windowId: number): ExplicitOperationReservation;
    /**
     * Starts pending projection preparation without awaiting storage.
     * @param reservation - The exact explicit operation to prepare.
     * @param windowId - The reservation's browser window.
     */
    prepareExplicitOperation(
        reservation: ExplicitOperationReservation,
        windowId: number,
    ): Promise<unknown>;
    /**
     * Cancels one exact expected navigation.
     * @param reservation - The expected navigation to cancel.
     * @param windowId - The reservation's browser window.
     */
    cancelExpectedNavigation(
        reservation: ExpectedNavigationReservation,
        windowId: number,
    ): void;
    /**
     * Cancels one exact explicit operation.
     * @param reservation - The explicit operation to cancel.
     * @param windowId - The reservation's browser window.
     * @param resynchronize - Whether its reserved target must be restored.
     */
    cancelExplicitOperation(
        reservation: ExplicitOperationReservation,
        windowId: number,
        resynchronize: boolean,
    ): void;
    /**
     * Opens the side panel for the clicking tab. Chrome honors the click's
     * user gesture only while the message listener runs synchronously, so the
     * call must be initiated before any await.
     * @param tabId - The browser tab whose window shows the panel.
     */
    openSidePanel(tabId: number): Promise<void>;
    /**
     * Records the clicked discussion with its exact reservation and source URL.
     * @param options - The explicit discussion selection to commit.
     */
    setSelection(
        options: ShowDiscussionOptions & { reservation: ExplicitOperationReservation; windowId: number },
    ): Promise<void>;
    /**
     * Reports a privacy-safe, allow-listed failure without page data.
     */
    warn: FollowWarningSink;
}

/**
 * Carries the validated article-click identity from the content script.
 */
export interface ArticleClickSelection {
    /**
     * Contains the concrete Hacker News item identifier.
     */
    itemId: string;
    /**
     * Contains the exact external article URL being opened.
     */
    articleUrl: string;
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
 * @param selection - The validated Hacker News item and source article URL.
 * @param sender - The runtime message sender to validate.
 * @param expectedOrigin - The only document origin allowed to report clicks.
 * @param dependencies - The setting, panel, and selection operations to use.
 */
export function respondToArticleClick(
    selection: ArticleClickSelection,
    sender: ArticleClickSender,
    expectedOrigin: string,
    dependencies: ArticleClickOpenDependencies,
): void {
    const { tabId, windowId } = sender;
    if (tabId === undefined || windowId === undefined || sender.origin !== expectedOrigin) {
        return;
    }
    const cached = dependencies.cachedEnabled();
    if (cached === false) {
        return;
    }
    const expected = dependencies.reserveExpectedNavigation(tabId, windowId, selection.articleUrl);
    const explicit = dependencies.reserveExplicitOperation(tabId, windowId);
    void dependencies.prepareExplicitOperation(explicit, windowId).catch(() => {
        dependencies.cancelExpectedNavigation(expected, windowId);
        dependencies.cancelExplicitOperation(explicit, windowId, true);
        dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED, { tabId, windowId });
    });
    void dependencies.openSidePanel(tabId).catch(() => {
        dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.OPEN_FAILED, { tabId, windowId });
    });
    void (async () => {
        let enabled: boolean;
        try {
            enabled = cached ?? await dependencies.readEnabled();
        } catch {
            dependencies.cancelExpectedNavigation(expected, windowId);
            dependencies.cancelExplicitOperation(explicit, windowId, true);
            dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED, { tabId, windowId });
            return;
        }
        if (!enabled) {
            dependencies.cancelExpectedNavigation(expected, windowId);
            dependencies.cancelExplicitOperation(explicit, windowId, true);
            return;
        }
        try {
            await dependencies.setSelection({
                reservation: explicit,
                tabId,
                windowId,
                itemId: selection.itemId,
                sourceUrl: selection.articleUrl,
            });
        } catch {
            dependencies.warn(FOLLOW_DIAGNOSTIC_CODE.SELECTION_FAILED, { tabId, windowId });
        }
    })();
}

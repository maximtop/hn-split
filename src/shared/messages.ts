import * as v from 'valibot';

import { hnLookupResultSchema } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import { isWebUrl } from '../domain/url';
import { ARTICLE_CLICK_MESSAGE_TYPE } from './content-scripts';
import { sidePanelContentSchema } from './side-panel-content';

/**
 * Names every request accepted by the background worker.
 */
export const BACKGROUND_REQUEST_TYPE = {
    LOOKUP: 'lookup',
    OPEN_DISCUSSION: 'open_discussion',
    SET_AVAILABILITY_SETTING: 'set_availability_setting',
    GET_AVAILABILITY_SETTING: 'get_availability_setting',
    SET_ARTICLE_CLICK_SETTING: 'set_article_click_setting',
    GET_ARTICLE_CLICK_SETTING: 'get_article_click_setting',
    SELECT_SIDE_PANEL_DISCUSSION: 'select_side_panel_discussion',
    GET_SIDE_PANEL_DISCUSSION: 'get_side_panel_discussion',
    CHECK_ACTIVE_SIDE_PANEL_TAB: 'check_active_side_panel_tab',
    ENABLE_SIDE_PANEL_FOLLOW: 'enable_side_panel_follow',
    GET_SIDE_PANEL_FOLLOW_SETTING: 'get_side_panel_follow_setting',
    SET_SIDE_PANEL_FOLLOW_SETTING: 'set_side_panel_follow_setting',
} as const;

/**
 * Names the runtime port the side panel keeps open for its whole lifetime, so
 * the background worker can scope the framing exception to a visible panel.
 */
export const SIDE_PANEL_PORT = 'side_panel';

/**
 * Names the periodic message a visible side panel sends over its long-lived
 * port so Chrome keeps the extension service worker active for the panel's
 * lifetime.
 */
export const SIDE_PANEL_KEEPALIVE = 'side_panel_keepalive';

/**
 * Keeps panel heartbeats below Chrome's 30-second extension-worker idle
 * deadline while avoiding unnecessary message traffic.
 */
export const SIDE_PANEL_KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * Delays reconnect attempts after an unexpected panel-port disconnect so a
 * temporarily restarting worker cannot cause a tight connection loop.
 */
export const SIDE_PANEL_RECONNECT_DELAY_MS = 250;

/**
 * Signals that the framing exception is installed and the panel may load the
 * discussion frame.
 */
export const SIDE_PANEL_READY = 'side_panel_ready';

/**
 * Binds one side-panel port to its owning browser window.
 */
export const SIDE_PANEL_CONTEXT = 'side_panel_context';

/**
 * Invalidates framing readiness and every retained discussion context.
 */
export const SIDE_PANEL_RESET = 'side_panel_reset';

/**
 * Discards retained discussion contexts associated with one tab.
 */
export const SIDE_PANEL_DISCARD_TAB = 'side_panel_discard_tab';

/**
 * Hides stale panel UI as soon as a newer authoritative target is reserved.
 */
export const SIDE_PANEL_TARGET = 'side_panel_target';

/**
 * Names every supported discussion-tab placement result.
 */
export const DISCUSSION_OPEN_MODE = {
    ADJACENT_TAB: 'adjacent_tab',
    REUSED_TAB: 'reused_tab',
    SPLIT_VIEW: 'split_view',
} as const;

/**
 * Names every stable background failure code carried by the protocol instead
 * of raw error text, so each UI surface translates failures in its own locale.
 */
export const BACKGROUND_ERROR_CODE = {
    LOOKUP_REQUEST_FAILED: 'lookup_request_failed',
    OPEN_DISCUSSION_FAILED: 'open_discussion_failed',
    SETTING_READ_FAILED: 'setting_read_failed',
    SETTING_UPDATE_FAILED: 'setting_update_failed',
    SIDE_PANEL_SELECTION_FAILED: 'side_panel_selection_failed',
} as const;

/**
 * Represents one stable background failure code.
 */
export type BackgroundErrorCode = typeof BACKGROUND_ERROR_CODE[keyof typeof BACKGROUND_ERROR_CODE];

const backgroundErrorCodeSchema = v.picklist(Object.values(BACKGROUND_ERROR_CODE));

const nonNegativeSafeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const positiveSafeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const positiveItemIdSchema = v.pipe(
    v.string(),
    v.regex(/^\d+$/),
    v.check((itemId) => {
        const value = Number(itemId);
        return Number.isSafeInteger(value) && value > 0;
    }),
);

/**
 * Validates the browser page URLs captured for discussion lookup.
 */
export const pageContextSchema = v.object({
    pageUrl: v.string(),
    canonicalHref: v.nullable(v.string()),
});

/**
 * Describes the browser page URLs used for discussion lookup.
 */
export type PageContext = v.InferOutput<typeof pageContextSchema>;

const lookupRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.LOOKUP),
    context: pageContextSchema,
});

const openDiscussionRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION),
    articleTabId: nonNegativeSafeIntegerSchema,
    itemId: positiveItemIdSchema,
});

const availabilitySettingSetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING),
    enabled: v.boolean(),
});

const availabilitySettingGetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING),
});

const articleClickSettingSetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.SET_ARTICLE_CLICK_SETTING),
    enabled: v.boolean(),
});

const articleClickSettingGetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.GET_ARTICLE_CLICK_SETTING),
});

const sidePanelSelectRequestSchema = v.strictObject({
    type: v.literal(BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION),
    tabId: nonNegativeSafeIntegerSchema,
    itemId: positiveItemIdSchema,
    sourceUrl: v.string(),
    windowId: nonNegativeSafeIntegerSchema,
});

const sidePanelGetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION),
    windowId: nonNegativeSafeIntegerSchema,
});

const followSettingSetRequestSchema = v.strictObject({
    type: v.literal(BACKGROUND_REQUEST_TYPE.SET_SIDE_PANEL_FOLLOW_SETTING),
    enabled: v.boolean(),
});

const followSettingGetRequestSchema = v.strictObject({
    type: v.literal(BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_FOLLOW_SETTING),
});

const checkActiveSidePanelTabRequestSchema = v.strictObject({
    type: v.literal(BACKGROUND_REQUEST_TYPE.CHECK_ACTIVE_SIDE_PANEL_TAB),
    windowId: nonNegativeSafeIntegerSchema,
});

const enableSidePanelFollowRequestSchema = v.strictObject({
    type: v.literal(BACKGROUND_REQUEST_TYPE.ENABLE_SIDE_PANEL_FOLLOW),
    windowId: nonNegativeSafeIntegerSchema,
});

const backgroundRequestSchema = v.variant('type', [
    lookupRequestSchema,
    availabilitySettingSetRequestSchema,
    availabilitySettingGetRequestSchema,
    articleClickSettingSetRequestSchema,
    articleClickSettingGetRequestSchema,
    openDiscussionRequestSchema,
    sidePanelSelectRequestSchema,
    sidePanelGetRequestSchema,
    followSettingSetRequestSchema,
    followSettingGetRequestSchema,
    checkActiveSidePanelTabRequestSchema,
    enableSidePanelFollowRequestSchema,
]);

/**
 * Requests a Hacker News lookup for one validated page context.
 */
export type LookupRequest = v.InferOutput<typeof lookupRequestSchema>;

/**
 * Requests opening one validated Hacker News discussion.
 */
export type OpenDiscussionRequest = v.InferOutput<typeof openDiscussionRequestSchema>;

/**
 * Requests a serialized automatic-availability setting transaction.
 */
export type AvailabilitySettingSetRequest = v.InferOutput<typeof availabilitySettingSetRequestSchema>;

/**
 * Requests the authoritative automatic-availability setting.
 */
export type AvailabilitySettingGetRequest = v.InferOutput<typeof availabilitySettingGetRequestSchema>;

/**
 * Requests a serialized article-click setting transaction.
 */
export type ArticleClickSettingSetRequest = v.InferOutput<typeof articleClickSettingSetRequestSchema>;

/**
 * Requests the authoritative article-click setting.
 */
export type ArticleClickSettingGetRequest = v.InferOutput<typeof articleClickSettingGetRequestSchema>;

/**
 * Requests that one validated discussion becomes one window's side panel
 * selection.
 */
export type SidePanelSelectRequest = v.InferOutput<typeof sidePanelSelectRequestSchema>;

/**
 * Requests the discussion currently selected for one window's side panel.
 */
export type SidePanelGetRequest = v.InferOutput<typeof sidePanelGetRequestSchema>;

/**
 * Requests one explicit check of the tab active in a panel window.
 */
export type CheckActiveSidePanelTabRequest = v.InferOutput<typeof checkActiveSidePanelTabRequestSchema>;

/**
 * Requests enabling follow and synchronizing the trusted active tab atomically.
 */
export type EnableSidePanelFollowRequest = v.InferOutput<typeof enableSidePanelFollowRequestSchema>;

/**
 * Requests the authoritative side-panel-follow preference.
 */
export type FollowSettingGetRequest = v.InferOutput<typeof followSettingGetRequestSchema>;

/**
 * Requests a serialized side-panel-follow preference mutation.
 */
export type FollowSettingSetRequest = v.InferOutput<typeof followSettingSetRequestSchema>;

/**
 * Represents every request accepted by the background worker.
 */
export type BackgroundRequest = v.InferOutput<typeof backgroundRequestSchema>;

const openDiscussionResultSchema = v.object({
    mode: v.picklist(Object.values(DISCUSSION_OPEN_MODE)),
    tabId: nonNegativeSafeIntegerSchema,
});

/**
 * Describes how and where a discussion tab was opened.
 */
export type OpenDiscussionResult = v.InferOutput<typeof openDiscussionResultSchema>;

const availabilitySettingResultSchema = v.object({
    enabled: v.boolean(),
});

const sidePanelContentResultSchema = v.object({
    content: v.nullable(sidePanelContentSchema),
});

/**
 * Carries what the side panel should display, or null when nothing has been
 * selected in this browser session.
 */
export type SidePanelContentResult = v.InferOutput<typeof sidePanelContentResultSchema>;

/**
 * Returns the authoritative automatic-availability setting after a read or mutation.
 */
export type AvailabilitySettingResult = v.InferOutput<typeof availabilitySettingResultSchema>;

const errorResponseSchema = v.object({
    ok: v.literal(false),
    error: backgroundErrorCodeSchema,
});

/**
 * Represents one failed background response carrying a stable error code.
 */
export type BackgroundErrorResponse = v.InferOutput<typeof errorResponseSchema>;

/**
 * Represents every response returned by the background worker.
 */
export type BackgroundResponse =
    | {
        ok: true;
        result: HnLookupResult | OpenDiscussionResult | AvailabilitySettingResult | SidePanelContentResult;
    }
    | BackgroundErrorResponse;

const sidePanelContentResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: sidePanelContentResultSchema }),
    errorResponseSchema,
]);

/**
 * Determines whether a runtime value carries the side panel content.
 * @param value - The unknown runtime value to validate.
 */
export function isSidePanelContentResponse(
    value: unknown,
): value is { ok: true; result: SidePanelContentResult } | BackgroundErrorResponse {
    return v.safeParse(sidePanelContentResponseSchema, value).success;
}

const availabilitySettingResponseSchema = v.object({
    ok: v.literal(true),
    result: availabilitySettingResultSchema,
});

const lookupResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: hnLookupResultSchema }),
    errorResponseSchema,
]);

const openDiscussionResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: openDiscussionResultSchema }),
    errorResponseSchema,
]);

/**
 * Determines whether a runtime value confirms an availability setting update.
 * @param value - The unknown runtime value to validate.
 */
export function isAvailabilitySettingResponse(
    value: unknown,
): value is { ok: true; result: AvailabilitySettingResult } {
    return v.safeParse(availabilitySettingResponseSchema, value).success;
}

/**
 * Determines whether a runtime value contains the authoritative availability setting.
 * @param value - The unknown runtime value to validate.
 */
export function isAvailabilitySettingReadResponse(
    value: unknown,
): value is { ok: true; result: AvailabilitySettingResult } {
    return isAvailabilitySettingResponse(value);
}

/**
 * Reads a validated background error code from an unknown response.
 * @param value - The unknown background response to inspect.
 */
export function readBackgroundError(value: unknown): BackgroundErrorCode | null {
    const result = v.safeParse(errorResponseSchema, value);
    return result.success ? result.output.error : null;
}

/**
 * Determines whether a runtime value is a lookup response or background error.
 * @param value - The unknown runtime value to validate.
 */
export function isLookupResponse(
    value: unknown,
): value is { ok: true; result: HnLookupResult } | BackgroundErrorResponse {
    return v.safeParse(lookupResponseSchema, value).success;
}

/**
 * Determines whether a runtime value is an opening response or background error.
 * @param value - The unknown runtime value to validate.
 */
export function isOpenDiscussionResponse(
    value: unknown,
): value is { ok: true; result: OpenDiscussionResult } | BackgroundErrorResponse {
    return v.safeParse(openDiscussionResponseSchema, value).success;
}

/**
 * Determines whether an unknown runtime message is an accepted background request.
 * @param value - The unknown runtime message to validate.
 */
export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
    return v.safeParse(backgroundRequestSchema, value).success;
}

const sidePanelPortMessageSchema = v.variant('type', [
    v.strictObject({
        type: v.literal(SIDE_PANEL_CONTEXT),
        windowId: nonNegativeSafeIntegerSchema,
    }),
    v.strictObject({ type: v.literal(SIDE_PANEL_KEEPALIVE) }),
    v.strictObject({
        type: v.literal(SIDE_PANEL_READY),
        tabId: nonNegativeSafeIntegerSchema,
        projectionRevision: positiveSafeIntegerSchema,
    }),
    v.strictObject({
        type: v.literal(SIDE_PANEL_TARGET),
        tabId: nonNegativeSafeIntegerSchema,
        minimumProjectionRevision: positiveSafeIntegerSchema,
    }),
    v.strictObject({ type: v.literal(SIDE_PANEL_RESET) }),
    v.strictObject({
        type: v.literal(SIDE_PANEL_DISCARD_TAB),
        tabId: nonNegativeSafeIntegerSchema,
    }),
]);

/**
 * Represents every validated lifecycle message sent over the side-panel port.
 */
export type SidePanelPortMessage = v.InferOutput<typeof sidePanelPortMessageSchema>;

/**
 * Determines whether an unknown value is a strict side-panel port message.
 * @param value - The unknown port message to validate.
 */
export function isSidePanelPortMessage(value: unknown): value is SidePanelPortMessage {
    return v.is(sidePanelPortMessageSchema, value);
}

const articleClickMessageSchema = v.strictObject({
    type: v.literal(ARTICLE_CLICK_MESSAGE_TYPE),
    itemId: positiveItemIdSchema,
    articleUrl: v.pipe(v.string(), v.check(isWebUrl)),
});

/**
 * Carries one qualifying story-link click observed by the Hacker News content
 * script. This message stays outside the request/response protocol: the
 * background listener must react synchronously to keep the click's user
 * gesture valid for `chrome.sidePanel.open`, and no response is read.
 */
export type ArticleClickMessage = v.InferOutput<typeof articleClickMessageSchema>;

/**
 * Determines whether an unknown runtime message reports a story-link click
 * from the Hacker News content script.
 * @param value - The unknown runtime message to validate.
 */
export function isArticleClickMessage(value: unknown): value is ArticleClickMessage {
    return v.is(articleClickMessageSchema, value);
}

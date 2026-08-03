import * as v from 'valibot';

import { hnLookupResultSchema } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';

/**
 * Names every request accepted by the background worker.
 */
export const BACKGROUND_REQUEST_TYPE = {
    LOOKUP: 'lookup',
    OPEN_DISCUSSION: 'open_discussion',
    SET_AVAILABILITY_SETTING: 'set_availability_setting',
    GET_AVAILABILITY_SETTING: 'get_availability_setting',
    SELECT_SIDE_PANEL_DISCUSSION: 'select_side_panel_discussion',
    GET_SIDE_PANEL_DISCUSSION: 'get_side_panel_discussion',
} as const;

/**
 * Names the runtime port the side panel keeps open for its whole lifetime, so
 * the background worker can scope the framing exception to a visible panel.
 */
export const SIDE_PANEL_PORT = 'side_panel';

/**
 * Signals that the framing exception is installed and the panel may load the
 * discussion frame.
 */
export const SIDE_PANEL_READY = 'side_panel_ready';

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

const sidePanelSelectRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.SELECT_SIDE_PANEL_DISCUSSION),
    itemId: positiveItemIdSchema,
});

const sidePanelGetRequestSchema = v.object({
    type: v.literal(BACKGROUND_REQUEST_TYPE.GET_SIDE_PANEL_DISCUSSION),
});

const backgroundRequestSchema = v.variant('type', [
    lookupRequestSchema,
    availabilitySettingSetRequestSchema,
    availabilitySettingGetRequestSchema,
    openDiscussionRequestSchema,
    sidePanelSelectRequestSchema,
    sidePanelGetRequestSchema,
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
 * Requests that one validated discussion becomes the side panel selection.
 */
export type SidePanelSelectRequest = v.InferOutput<typeof sidePanelSelectRequestSchema>;

/**
 * Requests the discussion currently selected for the side panel.
 */
export type SidePanelGetRequest = v.InferOutput<typeof sidePanelGetRequestSchema>;

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

const sidePanelSelectionResultSchema = v.object({
    itemId: v.nullable(positiveItemIdSchema),
});

/**
 * Carries the discussion currently selected for the side panel, or null when
 * the user has not selected one in this browser session.
 */
export type SidePanelSelectionResult = v.InferOutput<typeof sidePanelSelectionResultSchema>;

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
        result: HnLookupResult | OpenDiscussionResult | AvailabilitySettingResult | SidePanelSelectionResult;
    }
    | BackgroundErrorResponse;

const sidePanelSelectionResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: sidePanelSelectionResultSchema }),
    errorResponseSchema,
]);

/**
 * Determines whether a runtime value carries the side panel selection.
 * @param value - The unknown runtime value to validate.
 */
export function isSidePanelSelectionResponse(
    value: unknown,
): value is { ok: true; result: SidePanelSelectionResult } | BackgroundErrorResponse {
    return v.safeParse(sidePanelSelectionResponseSchema, value).success;
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

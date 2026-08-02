import * as v from 'valibot';

import { hnLookupResultSchema } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import type { PageContext } from '../page/context';

/**
 * Names every request accepted by the background worker.
 */
export const BACKGROUND_REQUEST_TYPE = {
    LOOKUP: 'lookup',
    OPEN_DISCUSSION: 'open_discussion',
    SET_AVAILABILITY_SETTING: 'set_availability_setting',
    GET_AVAILABILITY_SETTING: 'get_availability_setting',
} as const;

/**
 * Names every supported discussion-tab placement result.
 */
export const DISCUSSION_OPEN_MODE = {
    ADJACENT_TAB: 'adjacent_tab',
    REUSED_TAB: 'reused_tab',
    SPLIT_VIEW: 'split_view',
} as const;

const nonNegativeSafeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const positiveItemIdSchema = v.pipe(
    v.string(),
    v.regex(/^\d+$/),
    v.check((itemId) => {
        const value = Number(itemId);
        return Number.isSafeInteger(value) && value > 0;
    }),
);

const pageContextSchema = v.object({
    pageUrl: v.string(),
    canonicalHref: v.nullable(v.string()),
});

/**
 * Requests a Hacker News lookup for one validated page context.
 */
export interface LookupRequest {
    /**
     * Selects the lookup request handler.
     */
    type: typeof BACKGROUND_REQUEST_TYPE.LOOKUP;
    /**
     * Contains the current and canonical page URLs.
     */
    context: PageContext;
}

/**
 * Requests opening one validated Hacker News discussion.
 */
export interface OpenDiscussionRequest {
    /**
     * Selects the discussion-opening request handler.
     */
    type: typeof BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION;
    /**
     * Identifies the article tab that initiated the request.
     */
    articleTabId: number;
    /**
     * Identifies the positive Hacker News item to open.
     */
    itemId: string;
}

/**
 * Requests a serialized automatic-availability setting transaction.
 */
export interface AvailabilitySettingSetRequest {
    /**
     * Selects the automatic-availability setting handler.
     */
    type: typeof BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING;
    /**
     * Contains the requested automatic-availability state.
     */
    enabled: boolean;
}

/**
 * Requests the authoritative automatic-availability setting.
 */
export interface AvailabilitySettingGetRequest {
    /**
     * Selects the automatic-availability setting reader.
     */
    type: typeof BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING;
}

/**
 * Represents every request accepted by the background worker.
 */
export type BackgroundRequest =
    | LookupRequest
    | OpenDiscussionRequest
    | AvailabilitySettingSetRequest
    | AvailabilitySettingGetRequest;

/**
 * Describes how and where a discussion tab was opened.
 */
export interface OpenDiscussionResult {
    /**
     * Identifies whether Chrome created, reused, or preserved a Split View tab.
     */
    mode: typeof DISCUSSION_OPEN_MODE[keyof typeof DISCUSSION_OPEN_MODE];
    /**
     * Identifies the resulting discussion tab.
     */
    tabId: number;
}

/**
 * Returns the authoritative automatic-availability setting after a read or mutation.
 */
export interface AvailabilitySettingResult {
    /**
     * Contains the currently persisted setting value.
     */
    enabled: boolean;
}

/**
 * Represents every response returned by the background worker.
 */
export type BackgroundResponse =
    | {
        ok: true;
        result: HnLookupResult | OpenDiscussionResult | AvailabilitySettingResult;
    }
    | { ok: false; error: string };

const availabilitySettingResponseSchema = v.object({
    ok: v.literal(true),
    result: v.object({ enabled: v.boolean() }),
});

const errorResponseSchema = v.object({
    ok: v.literal(false),
    error: v.string(),
});

const lookupResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: hnLookupResultSchema }),
    errorResponseSchema,
]);

const openDiscussionResultSchema = v.object({
    mode: v.union([
        v.literal(DISCUSSION_OPEN_MODE.ADJACENT_TAB),
        v.literal(DISCUSSION_OPEN_MODE.REUSED_TAB),
        v.literal(DISCUSSION_OPEN_MODE.SPLIT_VIEW),
    ]),
    tabId: nonNegativeSafeIntegerSchema,
});

const openDiscussionResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: openDiscussionResultSchema }),
    errorResponseSchema,
]);

const backgroundRequestSchema = v.variant('type', [
    v.object({ type: v.literal(BACKGROUND_REQUEST_TYPE.LOOKUP), context: pageContextSchema }),
    v.object({
        type: v.literal(BACKGROUND_REQUEST_TYPE.SET_AVAILABILITY_SETTING),
        enabled: v.boolean(),
    }),
    v.object({ type: v.literal(BACKGROUND_REQUEST_TYPE.GET_AVAILABILITY_SETTING) }),
    v.object({
        type: v.literal(BACKGROUND_REQUEST_TYPE.OPEN_DISCUSSION),
        articleTabId: nonNegativeSafeIntegerSchema,
        itemId: positiveItemIdSchema,
    }),
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
 * Reads a validated background error message from an unknown response.
 * @param value - The unknown background response to inspect.
 */
export function readBackgroundError(value: unknown): string | null {
    const result = v.safeParse(errorResponseSchema, value);
    return result.success ? result.output.error : null;
}

/**
 * Determines whether a runtime value is a lookup response or background error.
 * @param value - The unknown runtime value to validate.
 */
export function isLookupResponse(
    value: unknown,
): value is { ok: true; result: HnLookupResult } | { ok: false; error: string } {
    return v.safeParse(lookupResponseSchema, value).success;
}

/**
 * Determines whether a runtime value is an opening response or background error.
 * @param value - The unknown runtime value to validate.
 */
export function isOpenDiscussionResponse(
    value: unknown,
): value is { ok: true; result: OpenDiscussionResult } | { ok: false; error: string } {
    return v.safeParse(openDiscussionResponseSchema, value).success;
}

/**
 * Determines whether an unknown runtime message is an accepted background request.
 * @param value - The unknown runtime message to validate.
 */
export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
    return v.safeParse(backgroundRequestSchema, value).success;
}

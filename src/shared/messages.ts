import * as v from 'valibot';

import type { OpenDiscussionResult } from '../browser/open-discussion';
import { hnLookupResultSchema } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';
import type { PageContext } from '../page/context';

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
    type: 'lookup';
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
    type: 'open_discussion';
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
export interface AvailabilitySettingChangedRequest {
    /**
     * Selects the automatic-availability setting handler.
     */
    type: 'availability_setting_changed';
    /**
     * Contains the requested automatic-availability state.
     */
    enabled: boolean;
}

/**
 * Represents every request accepted by the background worker.
 */
export type BackgroundRequest = LookupRequest | OpenDiscussionRequest | AvailabilitySettingChangedRequest;

/**
 * Confirms that an automatic-availability setting transaction completed.
 */
export interface AvailabilitySettingResult {
    /**
     * Marks the background-owned setting transaction as completed.
     */
    status: 'updated';
}

/**
 * Represents every response returned by the background worker.
 */
export type BackgroundResponse =
    | { ok: true; result: HnLookupResult | OpenDiscussionResult | AvailabilitySettingResult }
    | { ok: false; error: string };

const availabilitySettingResponseSchema = v.object({
    ok: v.literal(true),
    result: v.object({ status: v.literal('updated') }),
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
        v.literal('adjacent_tab'),
        v.literal('reused_tab'),
        v.literal('split_view'),
    ]),
    tabId: nonNegativeSafeIntegerSchema,
});

const openDiscussionResponseSchema = v.union([
    v.object({ ok: v.literal(true), result: openDiscussionResultSchema }),
    errorResponseSchema,
]);

const backgroundRequestSchema = v.variant('type', [
    v.object({ type: v.literal('lookup'), context: pageContextSchema }),
    v.object({ type: v.literal('availability_setting_changed'), enabled: v.boolean() }),
    v.object({
        type: v.literal('open_discussion'),
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

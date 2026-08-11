import * as v from 'valibot';

import { HN_LOOKUP_STATUS, isValidItemId } from '../domain/hn';
import type { HnLookupResult } from '../domain/hn';

/**
 * Names every state the side panel can be asked to display. The panel shows a
 * discussion frame only for `DISCUSSION`; the other kinds are the transient and
 * terminal states of a lookup started from the link context menu.
 */
export const SIDE_PANEL_CONTENT_KIND = {
    DISCUSSION: 'discussion',
    MANUAL_REQUIRED: 'manual_required',
    PENDING: 'pending',
    UNAVAILABLE: 'unavailable',
} as const;

/**
 * Represents one side panel content kind.
 */
export type SidePanelContentKind = typeof SIDE_PANEL_CONTENT_KIND[keyof typeof SIDE_PANEL_CONTENT_KIND];

const unavailableReasonSchema = v.picklist([
    HN_LOOKUP_STATUS.NOT_FOUND,
    HN_LOOKUP_STATUS.RESTRICTED,
    HN_LOOKUP_STATUS.ERROR,
]);

/**
 * Validates a Chrome tab identifier at every side-panel state boundary.
 */
export const sidePanelTabIdSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/**
 * Explains why no discussion can be shown, reusing the lookup status names so
 * each reason maps onto the message the popup already uses for that outcome.
 */
export type SidePanelUnavailableReason = v.InferOutput<typeof unavailableReasonSchema>;

/**
 * Validates the side panel content stored in session storage and carried by the
 * background protocol.
 */
export const sidePanelContentSchema = v.variant('kind', [
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.MANUAL_REQUIRED),
        tabId: sidePanelTabIdSchema,
    }),
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.PENDING),
        tabId: sidePanelTabIdSchema,
    }),
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.DISCUSSION),
        tabId: sidePanelTabIdSchema,
        itemId: v.pipe(v.string(), v.check(isValidItemId)),
    }),
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.UNAVAILABLE),
        tabId: sidePanelTabIdSchema,
        reason: unavailableReasonSchema,
    }),
]);

/**
 * Describes what the side panel should display right now.
 */
export type SidePanelContent = v.InferOutput<typeof sidePanelContentSchema>;

/**
 * Determines whether an unknown runtime value is valid side panel content.
 * @param value - The unknown runtime value to validate.
 */
export function isSidePanelContent(value: unknown): value is SidePanelContent {
    return v.is(sidePanelContentSchema, value);
}

/**
 * Converts one finished lookup into the state the side panel should show. Both
 * classified lookup failures collapse into a single unavailable reason, because
 * the distinction between a malformed response and a failed request is a
 * diagnostic detail rather than something the reader can act on.
 * @param result - The finished Hacker News lookup result to convert.
 * @param tabId - The authoritative tab that owns the outcome.
 */
export function contentForLookupResult(result: HnLookupResult, tabId: number): SidePanelContent {
    if (result.status === HN_LOOKUP_STATUS.FOUND) {
        return {
            kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION,
            tabId,
            itemId: result.primary.id,
        };
    }
    const reason = result.status === HN_LOOKUP_STATUS.NOT_FOUND
        || result.status === HN_LOOKUP_STATUS.RESTRICTED
        ? result.status
        : HN_LOOKUP_STATUS.ERROR;
    return {
        kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE,
        tabId,
        reason,
    };
}

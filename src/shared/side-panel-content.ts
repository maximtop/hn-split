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
 * Explains why no discussion can be shown, reusing the lookup status names so
 * each reason maps onto the message the popup already uses for that outcome.
 */
export type SidePanelUnavailableReason = v.InferOutput<typeof unavailableReasonSchema>;

/**
 * Validates the side panel content stored in session storage and carried by the
 * background protocol.
 */
export const sidePanelContentSchema = v.variant('kind', [
    v.object({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.DISCUSSION),
        itemId: v.pipe(v.string(), v.check(isValidItemId)),
    }),
    v.object({ kind: v.literal(SIDE_PANEL_CONTENT_KIND.PENDING) }),
    v.object({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.UNAVAILABLE),
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
 */
export function contentForLookupResult(result: HnLookupResult): SidePanelContent {
    if (result.status === HN_LOOKUP_STATUS.FOUND) {
        return { kind: SIDE_PANEL_CONTENT_KIND.DISCUSSION, itemId: result.primary.id };
    }
    if (result.status === HN_LOOKUP_STATUS.NOT_FOUND) {
        return { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.NOT_FOUND };
    }
    if (result.status === HN_LOOKUP_STATUS.RESTRICTED) {
        return { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.RESTRICTED };
    }
    return { kind: SIDE_PANEL_CONTENT_KIND.UNAVAILABLE, reason: HN_LOOKUP_STATUS.ERROR };
}

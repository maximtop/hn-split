import * as v from 'valibot';

import { HN_LOOKUP_STATUS, isValidItemId } from '../domain/hn';
import { isSanitizedArticleIdentity } from '../domain/url';
import {
    SIDE_PANEL_CONTENT_KIND,
    sidePanelTabIdSchema,
} from './side-panel-content';

/**
 * Names the authority that created a reusable tab association.
 */
export const SIDE_PANEL_ASSOCIATION_ORIGIN = {
    AUTOMATIC: 'automatic',
    EXPLICIT: 'explicit',
    MANUAL: 'manual',
} as const;

/**
 * Represents the authority that created a side-panel association.
 */
export type SidePanelAssociationOrigin = typeof SIDE_PANEL_ASSOCIATION_ORIGIN[
    keyof typeof SIDE_PANEL_ASSOCIATION_ORIGIN
];

const reusableOutcomeSchema = v.variant('kind', [
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.DISCUSSION),
        itemId: v.pipe(v.string(), v.check(isValidItemId)),
    }),
    v.strictObject({
        kind: v.literal(SIDE_PANEL_CONTENT_KIND.UNAVAILABLE),
        reason: v.picklist([
            HN_LOOKUP_STATUS.NOT_FOUND,
            HN_LOOKUP_STATUS.RESTRICTED,
        ]),
    }),
]);

/**
 * Describes a terminal panel outcome that can be reused for an unchanged tab.
 */
export type SidePanelReusableOutcome = v.InferOutput<typeof reusableOutcomeSchema>;

/**
 * Validates session-only tab associations before they can be restored.
 */
export const sidePanelAssociationSchema = v.strictObject({
    tabId: sidePanelTabIdSchema,
    windowId: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    origin: v.picklist(Object.values(SIDE_PANEL_ASSOCIATION_ORIGIN)),
    outcome: reusableOutcomeSchema,
    articleIdentity: v.nullable(v.pipe(v.string(), v.check(isSanitizedArticleIdentity))),
});

/**
 * Associates one reusable outcome with its current tab and window ownership.
 */
export type SidePanelAssociation = v.InferOutput<typeof sidePanelAssociationSchema>;

/**
 * Determines whether an unknown value is a strict reusable tab association.
 * @param value - The unknown storage value to validate.
 */
export function isSidePanelAssociation(value: unknown): value is SidePanelAssociation {
    return v.is(sidePanelAssociationSchema, value);
}

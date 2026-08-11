import * as v from 'valibot';

import {
    sidePanelContentSchema,
    sidePanelTabIdSchema,
} from './side-panel-content';

/**
 * Validates the revisioned side-panel outcome stored for one browser window.
 */
export const sidePanelProjectionSchema = v.strictObject({
    revision: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    content: sidePanelContentSchema,
});

/**
 * Contains the authoritative side-panel projection for one window.
 */
export type SidePanelProjection = v.InferOutput<typeof sidePanelProjectionSchema>;

/**
 * Identifies the exact projection whose framing setup has completed.
 */
export interface SidePanelReadyStamp {
    /**
     * Identifies the authoritative Chrome tab.
     */
    tabId: number;
    /**
     * Identifies the synchronized projection revision.
     */
    projectionRevision: number;
}

/**
 * Validates a framing-ready stamp received over the side-panel port.
 */
export const sidePanelReadyStampSchema = v.strictObject({
    tabId: sidePanelTabIdSchema,
    projectionRevision: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

/**
 * Determines whether an unknown value is a strict side-panel projection.
 * @param value - The unknown storage value to validate.
 */
export function isSidePanelProjection(value: unknown): value is SidePanelProjection {
    return v.is(sidePanelProjectionSchema, value);
}

/**
 * Determines whether framing readiness belongs to the exact local projection.
 * @param projection - The locally observed authoritative projection.
 * @param stamp - The framing-ready stamp received from the background worker.
 */
export function matchesReadyStamp(
    projection: SidePanelProjection | null,
    stamp: SidePanelReadyStamp | null,
): boolean {
    return projection !== null
        && stamp !== null
        && projection.revision === stamp.projectionRevision
        && projection.content.tabId === stamp.tabId;
}

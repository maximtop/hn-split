import * as v from 'valibot';

import { DIAGNOSTIC_EVENT, FOLLOW_DIAGNOSTIC_CODE } from './diagnostic-events';
import { SIDE_PANEL_CONTENT_KIND } from './side-panel-content';

/**
 * Caps retained entries and their UTF-8 JSON representation independently.
 */
export const DIAGNOSTIC_LIMIT = { ENTRIES: 1_000, BYTES: 1_048_576, PENDING: 1_000 } as const;

/**
 * Versions both the session envelope and exported JSON-lines format.
 */
export const DIAGNOSTIC_FORMAT_VERSION = 1;

/**
 * Restricts collection to extension-owned contexts, excluding content scripts.
 */
export const DIAGNOSTIC_SOURCE = {
    BACKGROUND: 'background', POPUP: 'popup', OPTIONS: 'options', SIDE_PANEL: 'side_panel',
} as const;

/**
 * Defines the supported console severities.
 */
export const DIAGNOSTIC_LEVEL = { INFO: 'info', WARNING: 'warning' } as const;

/**
 * Classifies failures without inspecting their message, stack or custom name.
 */
export const DIAGNOSTIC_ERROR = { TYPE: 'type_error', RANGE: 'range_error', OTHER: 'exception' } as const;

const identifier = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const detailsShape = {
    code: v.optional(v.picklist(Object.values(FOLLOW_DIAGNOSTIC_CODE))),
    tabId: v.optional(identifier),
    relatedTabId: v.optional(identifier),
    windowId: v.optional(identifier),
    revision: v.optional(identifier),
    kind: v.optional(v.picklist(Object.values(SIDE_PANEL_CONTENT_KIND))),
    errorCategory: v.optional(v.picklist(Object.values(DIAGNOSTIC_ERROR))),
};
const detailsInput = v.object(detailsShape);

/**
 * Rejects unknown messages, free-form strings and excess transport fields.
 */
export const diagnosticEventSchema = v.strictObject({
    level: v.picklist(Object.values(DIAGNOSTIC_LEVEL)),
    message: v.picklist(Object.values(DIAGNOSTIC_EVENT)),
    details: v.strictObject(detailsShape),
});

/**
 * Represents a sanitized event before background receipt.
 */
export type DiagnosticEvent = v.InferOutput<typeof diagnosticEventSchema>;

/**
 * Defines the stored entry, with its timestamp and source assigned by the worker.
 */
export const diagnosticEntrySchema = v.strictObject({
    ...diagnosticEventSchema.entries,
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    source: v.picklist(Object.values(DIAGNOSTIC_SOURCE)),
});

/**
 * Represents one safe retained entry.
 */
export type DiagnosticEntry = v.InferOutput<typeof diagnosticEntrySchema>;

/**
 * Validates the session envelope when restoring the worker or exporting.
 */
export const diagnosticBufferSchema = v.strictObject({
    formatVersion: v.literal(DIAGNOSTIC_FORMAT_VERSION),
    entries: v.pipe(v.array(diagnosticEntrySchema), v.maxLength(DIAGNOSTIC_LIMIT.ENTRIES)),
});

/**
 * Represents the versioned session envelope.
 */
export type DiagnosticBuffer = v.InferOutput<typeof diagnosticBufferSchema>;

/**
 * Reduces an error to its constructor category so no message or stack is retained.
 *
 * @param error - The console argument that is an Error.
 */
function categorizeError(error: Error): (typeof DIAGNOSTIC_ERROR)[keyof typeof DIAGNOSTIC_ERROR] {
    if (error instanceof TypeError) {
        return DIAGNOSTIC_ERROR.TYPE;
    }
    return error instanceof RangeError ? DIAGNOSTIC_ERROR.RANGE : DIAGNOSTIC_ERROR.OTHER;
}

/**
 * Drops unrecognized messages and rebuilds details from the scalar allowlist.
 *
 * @param level - Console severity to preserve.
 * @param message - Message that must belong to the application event catalog.
 * @param values - Console arguments; arbitrary objects and raw errors are never retained.
 */
export function normalizeDiagnostic(level: DiagnosticEvent['level'], message: string, values: unknown[]): DiagnosticEvent | null {
    const details: DiagnosticEvent['details'] = {};
    for (const value of values) {
        if (value instanceof Error) {
            details.errorCategory = categorizeError(value);
        } else {
            const parsed = v.safeParse(detailsInput, value);
            if (parsed.success) {
                Object.assign(details, parsed.output);
            }
        }
    }
    const result = v.safeParse(diagnosticEventSchema, { level, message, details });
    return result.success ? result.output : null;
}

/**
 * Counts the serialized session envelope in UTF-8 bytes.
 *
 * @param buffer - Validated envelope to measure.
 */
export function diagnosticBytes(buffer: DiagnosticBuffer): number {
    return new TextEncoder().encode(JSON.stringify(buffer)).byteLength;
}

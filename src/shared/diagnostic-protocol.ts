import * as v from 'valibot';

import { diagnosticBufferSchema, diagnosticEventSchema } from './diagnostics';
import { setDiagnosticSink } from './logger';

/**
 * Names the isolated diagnostic channel on the existing runtime boundary.
 */
export const DIAGNOSTIC_REQUEST = {
    APPEND: 'diagnostic_append', SNAPSHOT: 'diagnostic_snapshot', CLEAR: 'diagnostic_clear',
} as const;
/**
 * Rejects excess transport fields and unrecognized diagnostic payloads.
 */
export const diagnosticRequestSchema = v.variant('type', [
    v.strictObject({ type: v.literal(DIAGNOSTIC_REQUEST.APPEND), event: diagnosticEventSchema }),
    v.strictObject({ type: v.literal(DIAGNOSTIC_REQUEST.SNAPSHOT) }),
    v.strictObject({ type: v.literal(DIAGNOSTIC_REQUEST.CLEAR) }),
]);
/**
 * Represents accepted diagnostic operations.
 */
export type DiagnosticRequest = v.InferOutput<typeof diagnosticRequestSchema>;
/**
 * Validates a worker response before displaying or downloading its contents.
 */
export const diagnosticResponseSchema = v.variant('ok', [
    v.strictObject({ ok: v.literal(true), buffer: v.optional(diagnosticBufferSchema) }),
    v.strictObject({ ok: v.literal(false) }),
]);
/**
 * Represents a diagnostic response without arbitrary error text.
 */
export type DiagnosticResponse = v.InferOutput<typeof diagnosticResponseSchema>;
/**
 * Sends requests through the browser runtime boundary.
 */
export type DiagnosticTransport = (request: DiagnosticRequest) => Promise<unknown>;

/**
 * Installs a one-way UI event transport; the worker is the only writer.
 * @param send - Runtime transport owned by the current extension document.
 */
export function installDiagnosticTransport(send: DiagnosticTransport): void {
    setDiagnosticSink(async (event) => {
        const response = v.parse(diagnosticResponseSchema, await send({ type: DIAGNOSTIC_REQUEST.APPEND, event }));
        if (!response.ok) {
            throw new Error('Diagnostic append failed');
        }
    });
}

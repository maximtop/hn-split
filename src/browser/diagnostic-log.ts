import * as v from 'valibot';

import {
    DIAGNOSTIC_FORMAT_VERSION, DIAGNOSTIC_LIMIT, diagnosticBufferSchema, diagnosticBytes,
} from '../shared/diagnostics';
import { reportDiagnosticFailure } from '../shared/logger';

import type { DiagnosticBuffer, DiagnosticEntry, DiagnosticEvent } from '../shared/diagnostics';

/**
 * Isolates the worker-owned session storage record.
 */
export interface DiagnosticStorage {
    /**
     * Reads the diagnostic envelope, never other session values.
     */
    read: () => Promise<unknown>;

    /**
     * Replaces the retained diagnostic envelope.
     *
     * @param buffer - Validated and bounded session log.
     */
    write: (buffer: DiagnosticBuffer) => Promise<void>;

    /**
     * Removes only the diagnostic record.
     */
    clear: () => Promise<void>;
}

/**
 * Serializes append, snapshot and clear against one background-owned record.
 */
export class DiagnosticLog {
    private queue: Promise<unknown> = Promise.resolve();

    private pending = 0;

    /**
     * Creates a collector with independent retention caps.
     *
     * @param storage - Session storage used across worker instances.
     * @param limits - Retention caps; smaller values support bounded deployments and tests.
     */
    constructor(
        private readonly storage: DiagnosticStorage,
        private readonly limits = { entries: DIAGNOSTIC_LIMIT.ENTRIES as number, bytes: DIAGNOSTIC_LIMIT.BYTES as number },
    ) {}

    /**
     * Appends a normalized event in receipt order without retaining caller-owned objects.
     *
     * @param event - Validated scalar-only diagnostic event.
     * @param source - Context established by the background transport.
     */
    append(event: DiagnosticEvent, source: DiagnosticEntry['source']): Promise<void> {
        if (this.pending >= DIAGNOSTIC_LIMIT.PENDING) {
            return Promise.reject(new Error('Diagnostic queue full'));
        }
        const entry: DiagnosticEntry = {
            ...event, details: { ...event.details }, source, timestamp: new Date().toISOString(),
        };
        return this.enqueue(async () => {
            const buffer = await this.read();
            buffer.entries.push(entry);
            while (buffer.entries.length > this.limits.entries || diagnosticBytes(buffer) > this.limits.bytes) {
                if (buffer.entries.length === 0) {
                    throw new Error('Diagnostic byte limit too small');
                }
                buffer.entries.shift();
            }
            await this.storage.write(buffer);
        });
    }

    /**
     * Returns a snapshot after all earlier mutations have settled.
     */
    snapshot(): Promise<DiagnosticBuffer> {
        return this.enqueue(() => this.read());
    }

    /**
     * Removes the record after earlier appends, before later ones.
     */
    clear(): Promise<void> {
        return this.enqueue(() => this.storage.clear());
    }

    /**
     * Restores validated session data, dropping a malformed envelope as one unit.
     */
    private async read(): Promise<DiagnosticBuffer> {
        const stored = await this.storage.read();
        if (stored === undefined) {
            return { formatVersion: DIAGNOSTIC_FORMAT_VERSION, entries: [] };
        }
        const result = v.safeParse(diagnosticBufferSchema, stored);
        if (result.success && diagnosticBytes(result.output) <= DIAGNOSTIC_LIMIT.BYTES) {
            return result.output;
        }
        reportDiagnosticFailure();
        await this.storage.clear();
        return { formatVersion: DIAGNOSTIC_FORMAT_VERSION, entries: [] };
    }

    /**
     * Keeps later operations runnable after a rejected storage operation.
     *
     * @param operation - Storage operation reserved in invocation order.
     */
    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        this.pending += 1;
        const result = this.queue.then(operation);
        this.queue = result.then(() => undefined, () => undefined).finally(() => {
            this.pending -= 1;
        });
        return result;
    }
}

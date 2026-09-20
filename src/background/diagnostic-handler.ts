import * as v from 'valibot';

import type { DiagnosticLog } from '../browser/diagnostic-log';
import { DIAGNOSTIC_SOURCE } from '../shared/diagnostics';
import { DIAGNOSTIC_REQUEST, diagnosticRequestSchema } from '../shared/diagnostic-protocol';
import type { DiagnosticResponse } from '../shared/diagnostic-protocol';
import { reportDiagnosticFailure } from '../shared/logger';

/**
 * Creates a sender-checked handler for extension UI diagnostics.
 * @param log - Single background-owned collector.
 * @param runtime - Extension identity used to authenticate exact document URLs.
 */
export function createDiagnosticHandler(
    log: DiagnosticLog, runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>,
): (message: unknown, sender: chrome.runtime.MessageSender) => Promise<DiagnosticResponse> | null {
    const sources = new Map([
        [runtime.getURL('popup.html'), DIAGNOSTIC_SOURCE.POPUP],
        [runtime.getURL('options.html'), DIAGNOSTIC_SOURCE.OPTIONS],
        [runtime.getURL('side-panel.html'), DIAGNOSTIC_SOURCE.SIDE_PANEL],
    ]);
    return (message, sender) => {
        const parsed = v.safeParse(diagnosticRequestSchema, message);
        // Options may be hosted in a tab; exact extension-document URLs exclude
        // website content scripts, even when they share our extension ID.
        const source = sender.id === runtime.id ? sources.get(sender.url ?? '') : undefined;
        if (!parsed.success || source === undefined) {
            return null;
        }
        const request = parsed.output;
        if (request.type !== DIAGNOSTIC_REQUEST.APPEND && source !== DIAGNOSTIC_SOURCE.OPTIONS) {
            return null;
        }
        const operation = async (): Promise<DiagnosticResponse> => {
            try {
                if (request.type === DIAGNOSTIC_REQUEST.APPEND) {
                    await log.append(request.event, source);
                    return { ok: true };
                }
                if (request.type === DIAGNOSTIC_REQUEST.CLEAR) {
                    await log.clear();
                    return { ok: true };
                }
                return { ok: true, buffer: await log.snapshot() };
            } catch {
                reportDiagnosticFailure();
                return { ok: false };
            }
        };
        return operation();
    };
}

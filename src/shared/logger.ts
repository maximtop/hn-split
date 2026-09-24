/**
 * @file Provides the console logging helpers of the extension. They add the product prefix, restrict warning
 * payloads to allow-listed identifiers, and forward sanitized events to the installed diagnostic sink.
 */

import { EXTENSION_BRAND } from './brand';
import {
    FOLLOW_DIAGNOSTIC_CODE,
    FOLLOW_DIAGNOSTIC_EVENT,
    FOLLOW_DIAGNOSTIC_EVENT_BY_CODE,
} from './diagnostic-events';
import { DIAGNOSTIC_LEVEL, normalizeDiagnostic } from './diagnostics';

import type { FollowDiagnosticCode, FollowDiagnosticDetails, FollowDiagnosticEvent } from './diagnostic-events';
import type { DiagnosticEvent } from './diagnostics';

/**
 * Represents a primitive value allowed in the inline details of a lifecycle log line.
 */
type DiagnosticValue = boolean | number | string | null | undefined;

export { FOLLOW_DIAGNOSTIC_CODE, FOLLOW_DIAGNOSTIC_EVENT } from './diagnostic-events';
export type {
    FollowDiagnosticCode, FollowDiagnosticDetails, FollowDiagnosticEvent, FollowWarningSink,
} from './diagnostic-events';

/**
 * Receives sanitized events without making product operations await storage.
 */
export type DiagnosticSink = (event: DiagnosticEvent) => Promise<unknown>;

let diagnosticSink: DiagnosticSink | undefined;

/**
 * Installs the current extension entry's transport; content scripts leave it unset.
 *
 * @param sink - Direct background writer or one-way UI event transport.
 */
export function setDiagnosticSink(sink: DiagnosticSink | undefined): void {
    diagnosticSink = sink;
}

/**
 * Reports collector failures directly without retaining error payloads or recursing.
 */
export function reportDiagnosticFailure(): void {
    console.warn(`${EXTENSION_BRAND}: diagnostic collection unavailable.`);
}

/**
 * Sends one normalized event to the configured best-effort sink.
 *
 * @param level - Stable severity of the console event.
 * @param message - Application message checked against the event catalog.
 * @param details - Untrusted values normalized before reaching a transport.
 */
function collectDiagnostic(level: DiagnosticEvent['level'], message: string, details: unknown[]): void {
    if (diagnosticSink === undefined) {
        return;
    }
    try {
        const event = normalizeDiagnostic(level, message, details);
        if (event !== null) {
            void diagnosticSink(event).catch(reportDiagnosticFailure);
        }
    } catch {
        reportDiagnosticFailure();
    }
}

const ALLOWED_FOLLOW_DIAGNOSTIC_EVENTS = new Set<FollowDiagnosticEvent>(
    Object.values(FOLLOW_DIAGNOSTIC_EVENT),
);
const ALLOWED_FOLLOW_DIAGNOSTIC_CODES = new Set<FollowDiagnosticCode>(
    Object.values(FOLLOW_DIAGNOSTIC_CODE),
);

/**
 * Logs a privacy-safe lifecycle event locally so cross-context extension flows
 * can be traced without telemetry or persistent diagnostic storage.
 *
 * @param message - The stable lifecycle description.
 * @param details - Optional allow-listed primitive context serialized inline.
 */
export function logDiagnostic(
    message: string,
    details?: Readonly<Record<string, DiagnosticValue>>,
): void {
    const serializedDetails = details === undefined ? '' : ` ${JSON.stringify(details)}`;
    // The logger is the only place that writes to the console; info keeps these events visible by default.
    // eslint-disable-next-line no-console
    console.info(`${EXTENSION_BRAND}: ${message}${serializedDetails}`);
    collectDiagnostic(DIAGNOSTIC_LEVEL.INFO, message, [details]);
}

/**
 * Logs one typed side-panel warning after rebuilding its runtime payload from
 * the identifier allow-list, preventing excess object properties from leaking.
 *
 * @param event - The stable allow-listed lifecycle description.
 * @param details - The stable code and optional ephemeral numeric identifiers.
 */
export function logDiagnosticWarning(
    event: FollowDiagnosticEvent,
    details: Readonly<FollowDiagnosticDetails>,
): void {
    const safeEvent = ALLOWED_FOLLOW_DIAGNOSTIC_EVENTS.has(event)
        ? event
        : FOLLOW_DIAGNOSTIC_EVENT.REJECTED;
    const safeDetails: FollowDiagnosticDetails = {
        code: ALLOWED_FOLLOW_DIAGNOSTIC_CODES.has(details.code)
            ? details.code
            : FOLLOW_DIAGNOSTIC_CODE.REJECTED,
        ...(Number.isSafeInteger(details.tabId) ? { tabId: details.tabId } : {}),
        ...(Number.isSafeInteger(details.relatedTabId)
            ? { relatedTabId: details.relatedTabId }
            : {}),
        ...(Number.isSafeInteger(details.windowId) ? { windowId: details.windowId } : {}),
    };
    console.warn(`${EXTENSION_BRAND}: ${safeEvent} ${JSON.stringify(safeDetails)}`);
    collectDiagnostic(DIAGNOSTIC_LEVEL.WARNING, safeEvent, [safeDetails]);
}

/**
 * Maps one typed warning code to its stable event and logs a sanitized payload.
 *
 * @param code - The stable allow-listed warning code.
 * @param details - Optional ephemeral numeric identifiers only.
 */
export function logFollowWarning(
    code: FollowDiagnosticCode,
    details: Readonly<Omit<FollowDiagnosticDetails, 'code'>>,
): void {
    logDiagnosticWarning(FOLLOW_DIAGNOSTIC_EVENT_BY_CODE[code], { code, ...details });
}

/**
 * Logs a recoverable failure with the brand prefix so extension entries stay
 * attributable in consoles shared with page scripts.
 *
 * @param message - The human-readable failure description.
 * @param details - Optional error or context values appended to the entry.
 */
export function logWarning(message: string, ...details: unknown[]): void {
    console.warn(`${EXTENSION_BRAND}:`, message, ...details);
    collectDiagnostic(DIAGNOSTIC_LEVEL.WARNING, message, details);
}

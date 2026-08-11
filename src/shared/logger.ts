import { EXTENSION_BRAND } from './brand';

type DiagnosticValue = boolean | number | string | null | undefined;

/**
 * Provides the closed set of privacy-safe side-panel diagnostic messages.
 */
export const FOLLOW_DIAGNOSTIC_EVENT = {
    ACTION_FAILED: 'running the side panel action failed.',
    ASSOCIATION_WRITE_FAILED: 'persisting the side panel association failed.',
    FRAMING_ACQUIRE_FAILED: 'acquiring side panel framing failed.',
    FRAMING_RELEASE_FAILED: 'releasing side panel framing failed.',
    DISCONNECT_FAILED: 'disconnecting the side panel failed.',
    INITIALIZATION_FAILED: 'initializing the side panel failed.',
    LOOKUP_FAILED: 'looking up the side panel tab failed.',
    OPEN_FAILED: 'opening the side panel failed.',
    SELECTION_FAILED: 'selecting the side panel discussion failed.',
    TAB_LIFECYCLE_FAILED: 'processing a side panel tab lifecycle event failed.',
    REJECTED: 'invalid side panel diagnostic was rejected.',
} as const;

/**
 * Provides stable machine-readable codes for side-panel diagnostics.
 */
export const FOLLOW_DIAGNOSTIC_CODE = {
    ACTION_FAILED: 'side_panel_action_failed',
    ASSOCIATION_WRITE_FAILED: 'association_write_failed',
    FRAMING_ACQUIRE_FAILED: 'framing_acquire_failed',
    FRAMING_RELEASE_FAILED: 'framing_release_failed',
    DISCONNECT_FAILED: 'side_panel_disconnect_failed',
    INITIALIZATION_FAILED: 'side_panel_initialization_failed',
    LOOKUP_FAILED: 'side_panel_lookup_failed',
    OPEN_FAILED: 'side_panel_open_failed',
    SELECTION_FAILED: 'side_panel_selection_failed',
    TAB_LIFECYCLE_FAILED: 'side_panel_tab_lifecycle_failed',
    REJECTED: 'side_panel_diagnostic_rejected',
} as const;

/**
 * Represents one allow-listed side-panel diagnostic event.
 */
export type FollowDiagnosticEvent = typeof FOLLOW_DIAGNOSTIC_EVENT[
    keyof typeof FOLLOW_DIAGNOSTIC_EVENT
];

/**
 * Represents one allow-listed side-panel diagnostic code.
 */
export type FollowDiagnosticCode = typeof FOLLOW_DIAGNOSTIC_CODE[
    keyof typeof FOLLOW_DIAGNOSTIC_CODE
];

/**
 * Contains the only ephemeral identifiers accepted by side-panel diagnostics.
 */
export interface FollowDiagnosticDetails {
    /**
     * Contains the stable allow-listed failure code.
     */
    code: FollowDiagnosticCode;
    /**
     * Identifies the affected tab when known.
     */
    tabId?: number;
    /**
     * Identifies a related tab for lifecycle operations when known.
     */
    relatedTabId?: number;
    /**
     * Identifies the affected browser window when known.
     */
    windowId?: number;
}

/**
 * Accepts one typed follow diagnostic without any caught values or page data.
 */
export type FollowWarningSink = (
    code: FollowDiagnosticCode,
    details: Readonly<Omit<FollowDiagnosticDetails, 'code'>>,
) => void;

const FOLLOW_DIAGNOSTIC_EVENT_BY_CODE: Record<FollowDiagnosticCode, FollowDiagnosticEvent> = {
    [FOLLOW_DIAGNOSTIC_CODE.ACTION_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.ACTION_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.ASSOCIATION_WRITE_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.ASSOCIATION_WRITE_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.FRAMING_ACQUIRE_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.FRAMING_ACQUIRE_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.FRAMING_RELEASE_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.FRAMING_RELEASE_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.DISCONNECT_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.DISCONNECT_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.INITIALIZATION_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.INITIALIZATION_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.LOOKUP_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.LOOKUP_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.OPEN_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.OPEN_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.SELECTION_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.SELECTION_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.TAB_LIFECYCLE_FAILED]: FOLLOW_DIAGNOSTIC_EVENT.TAB_LIFECYCLE_FAILED,
    [FOLLOW_DIAGNOSTIC_CODE.REJECTED]: FOLLOW_DIAGNOSTIC_EVENT.REJECTED,
};

const ALLOWED_FOLLOW_DIAGNOSTIC_EVENTS = new Set<FollowDiagnosticEvent>(
    Object.values(FOLLOW_DIAGNOSTIC_EVENT),
);
const ALLOWED_FOLLOW_DIAGNOSTIC_CODES = new Set<FollowDiagnosticCode>(
    Object.values(FOLLOW_DIAGNOSTIC_CODE),
);

/**
 * Logs a privacy-safe lifecycle event locally so cross-context extension flows
 * can be traced without telemetry or persistent diagnostic storage.
 * @param message - The stable lifecycle description.
 * @param details - Optional allow-listed primitive context serialized inline.
 */
export function logDiagnostic(
    message: string,
    details?: Readonly<Record<string, DiagnosticValue>>,
): void {
    const serializedDetails = details === undefined ? '' : ` ${JSON.stringify(details)}`;
    console.info(`${EXTENSION_BRAND}: ${message}${serializedDetails}`);
}

/**
 * Logs one typed side-panel warning after rebuilding its runtime payload from
 * the identifier allow-list, preventing excess object properties from leaking.
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
}

/**
 * Maps one typed warning code to its stable event and logs a sanitized payload.
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
 * @param message - The human-readable failure description.
 * @param details - Optional error or context values appended to the entry.
 */
export function logWarning(message: string, ...details: unknown[]): void {
    console.warn(`${EXTENSION_BRAND}:`, message, ...details);
}

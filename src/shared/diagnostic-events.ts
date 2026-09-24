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

export const FOLLOW_DIAGNOSTIC_EVENT_BY_CODE: Record<FollowDiagnosticCode, FollowDiagnosticEvent> = {
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

/**
 * Lists the only application messages admitted to the session log.
 */
export const DIAGNOSTIC_EVENT = {
    ...FOLLOW_DIAGNOSTIC_EVENT,
    FRAMING_READY: 'side panel framing ready.',
    PROJECTION_LOADED: 'side panel projection loaded.',
    SELECTION_STORED: 'side panel selection stored.',
    FRAMING_RESET_FAILED: 'clearing the side panel framing exception failed.',
    REGISTRATION_FAILED: 'reconciling the article-click content script failed.',
    MENU_FAILED: 'publishing the link context menu failed.',
    NORMALIZATION_FAILED: 'normalizing the side panel content failed.',
    AVAILABILITY_FAILED: 'automatic availability update failed.',
    POPUP_LOOKUP_FAILED: 'popup lookup failed.',
    DISCUSSION_OPEN_FAILED: 'opening the discussion failed.',
    REQUEST_FAILED: 'background request failed.',
    SETTING_LOAD_FAILED: 'loading the setting failed.',
    SETTING_UPDATE_FAILED: 'updating the setting failed.',
    SETTING_RELOAD_FAILED: 'reloading the setting failed.',
} as const;

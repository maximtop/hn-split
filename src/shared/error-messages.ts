import { t } from './i18n';
import type { MessageKey } from './i18n';
import { BACKGROUND_ERROR_CODE } from './messages';
import type { BackgroundErrorCode } from './messages';

const ERROR_MESSAGE_KEY: Record<BackgroundErrorCode, MessageKey> = {
    [BACKGROUND_ERROR_CODE.LOOKUP_REQUEST_FAILED]: 'lookup_error',
    [BACKGROUND_ERROR_CODE.OPEN_DISCUSSION_FAILED]: 'open_discussion_failed',
    [BACKGROUND_ERROR_CODE.SETTING_READ_FAILED]: 'unable_to_load_settings',
    [BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED]: 'unable_to_update_settings',
    [BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED]: 'side_panel_empty',
};

/**
 * Marks an error whose message is already localized user-facing copy, keeping
 * it distinguishable from runtime errors that carry raw diagnostic text.
 */
export class UserFacingError extends Error {}

/**
 * Resolves the locale key describing one stable background failure code.
 * @param code - The stable background error code to describe.
 */
export function messageKeyForBackgroundError(code: BackgroundErrorCode): MessageKey {
    return ERROR_MESSAGE_KEY[code];
}

/**
 * Produces user-facing copy for an unknown thrown value without leaking raw
 * diagnostic text into the UI.
 * @param error - The unknown thrown value to describe.
 * @param fallbackKey - The locale key used for non-user-facing errors.
 */
export function userFacingMessage(error: unknown, fallbackKey: MessageKey): string {
    return error instanceof UserFacingError ? error.message : t(fallbackKey);
}

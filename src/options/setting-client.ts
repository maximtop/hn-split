import { UserFacingError, messageKeyForBackgroundError } from '../shared/error-messages';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';
import {
    isAvailabilitySettingReadResponse,
    isAvailabilitySettingResponse,
    readBackgroundError,
} from '../shared/messages';

/**
 * Defines the background messaging operations used by one boolean option.
 */
export interface BooleanSettingDependencies {
    /**
     * Requests the authoritative setting from the background worker.
     */
    readCurrent(): Promise<unknown>;
    /**
     * Requests one background-owned setting transaction and resolves with the
     * worker's raw response.
     * @param enabled - Whether the setting should be enabled.
     */
    requestUpdate(enabled: boolean): Promise<unknown>;
}

/**
 * Converts an invalid or rejected background response into localized copy.
 * @param response - The untrusted background response to interpret.
 * @param fallbackKey - The locale key used when the response carries no known code.
 */
function responseError(response: unknown, fallbackKey: MessageKey): UserFacingError {
    const code = readBackgroundError(response);
    return new UserFacingError(t(code === null ? fallbackKey : messageKeyForBackgroundError(code)));
}

/**
 * Reads one authoritative boolean setting through the background worker.
 * @param dependencies - The background messaging operations used by the request.
 */
export async function readBooleanSetting(
    dependencies: BooleanSettingDependencies,
): Promise<boolean> {
    const response = await dependencies.readCurrent();
    if (!isAvailabilitySettingReadResponse(response)) {
        throw responseError(response, 'unable_to_load_settings');
    }
    return response.result.enabled;
}

/**
 * Requests one background-owned boolean setting transaction and returns its
 * authoritative persisted value.
 * @param enabled - Whether the setting should be enabled.
 * @param dependencies - The background messaging operations used by the request.
 */
export async function updateBooleanSetting(
    enabled: boolean,
    dependencies: BooleanSettingDependencies,
): Promise<boolean> {
    const response = await dependencies.requestUpdate(enabled);
    if (!isAvailabilitySettingResponse(response)) {
        throw responseError(response, 'unable_to_update_settings');
    }
    return response.result.enabled;
}

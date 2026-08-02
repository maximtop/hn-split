import {
    isAvailabilitySettingReadResponse,
    isAvailabilitySettingResponse,
    readBackgroundError,
} from '../shared/messages';

/**
 * Defines the side effects required to update automatic availability.
 */
export interface AvailabilitySettingsDependencies {
    /**
     * Requests the authoritative setting from the background worker.
     */
    readCurrent(): Promise<unknown>;
    /**
     * Notifies the background worker of the requested setting value.
     * @param enabled - Whether automatic availability should be enabled.
     */
    notifyChanged(enabled: boolean): Promise<unknown>;
}

/**
 * Names every successful automatic-availability update result.
 */
export const AVAILABILITY_UPDATE_RESULT = {
    ENABLED: 'enabled',
    DISABLED: 'disabled',
} as const;

/**
 * Represents the result of a successful automatic-availability update.
 */
export type AvailabilityUpdateResult = typeof AVAILABILITY_UPDATE_RESULT[keyof typeof AVAILABILITY_UPDATE_RESULT];

/**
 * Reads the authoritative automatic-availability setting through the background worker.
 * @param dependencies - The background messaging operations used by the request.
 */
export async function readAutomaticAvailability(
    dependencies: AvailabilitySettingsDependencies,
): Promise<boolean> {
    const response = await dependencies.readCurrent();
    if (!isAvailabilitySettingReadResponse(response)) {
        throw responseError(response);
    }
    return response.result.enabled;
}

/**
 * Converts an invalid or rejected background response into a useful error.
 * @param response - The untrusted background response to interpret.
 */
function responseError(response: unknown): Error {
    const message = readBackgroundError(response);
    return new Error(message ?? 'Background did not confirm the setting change');
}

/**
 * Requests one background-owned automatic-availability setting transaction.
 * @param enabled - Whether automatic availability should be enabled.
 * @param dependencies - The background messaging operations used by the request.
 */
export async function updateAutomaticAvailability(
    enabled: boolean,
    dependencies: AvailabilitySettingsDependencies,
): Promise<AvailabilityUpdateResult> {
    const response = await dependencies.notifyChanged(enabled);
    if (!isAvailabilitySettingResponse(response)) {
        throw responseError(response);
    }
    return response.result.enabled
        ? AVAILABILITY_UPDATE_RESULT.ENABLED
        : AVAILABILITY_UPDATE_RESULT.DISABLED;
}

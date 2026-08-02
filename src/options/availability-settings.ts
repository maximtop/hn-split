import { isAvailabilitySettingResponse, readBackgroundError } from '../shared/messages';

/**
 * Defines the side effects required to update automatic availability.
 */
export interface AvailabilitySettingsDependencies {
    /**
     * Notifies the background worker of the requested setting value.
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
 * Converts an invalid or rejected background response into a useful error.
 */
function responseError(response: unknown): Error {
    const message = readBackgroundError(response);
    return new Error(message ?? 'Background did not confirm the setting change');
}

/**
 * Requests one background-owned automatic-availability setting transaction.
 */
export async function updateAutomaticAvailability(
    enabled: boolean,
    dependencies: AvailabilitySettingsDependencies,
): Promise<AvailabilityUpdateResult> {
    const response = await dependencies.notifyChanged(enabled);
    if (!isAvailabilitySettingResponse(response)) {
        throw responseError(response);
    }
    return enabled
        ? AVAILABILITY_UPDATE_RESULT.ENABLED
        : AVAILABILITY_UPDATE_RESULT.DISABLED;
}

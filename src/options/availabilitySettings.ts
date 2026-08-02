import { isAvailabilitySettingResponse } from '../shared/messages';

export interface AvailabilitySettingsDependencies {
    notifyChanged(enabled: boolean): Promise<unknown>;
}

export type AvailabilityUpdateResult = 'enabled' | 'disabled';

function responseError(response: unknown): Error {
    if (typeof response === 'object' && response !== null
        && (response as Record<string, unknown>).ok === false
        && typeof (response as Record<string, unknown>).error === 'string') {
        return new Error((response as Record<string, unknown>).error as string);
    }
    return new Error('Background did not confirm the setting change');
}

export async function updateAutomaticAvailability(
    enabled: boolean,
    dependencies: AvailabilitySettingsDependencies,
): Promise<AvailabilityUpdateResult> {
    const response = await dependencies.notifyChanged(enabled);
    if (!isAvailabilitySettingResponse(response)) {
        throw responseError(response);
    }
    return enabled ? 'enabled' : 'disabled';
}

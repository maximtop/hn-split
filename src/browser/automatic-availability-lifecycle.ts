/** Defines storage and effect operations for automatic availability. */
export interface AutomaticAvailabilityLifecycleDependencies {
    /** Reads the authoritative persisted setting. */
    getEnabled(): Promise<boolean>;
    /** Persists the authoritative setting value. */
    setEnabled(enabled: boolean): Promise<void>;
    /** Enables automatic availability effects. */
    enable(): Promise<void>;
    /** Disables automatic availability effects and clears derived state. */
    disable(): Promise<void>;
}

/** Represents one serialized automatic-availability setting operation. */
export type AutomaticAvailabilitySettingOperation = (enabled: boolean) => Promise<void>;

/** Creates a queue that serializes setting changes in request order. */
export function createAutomaticAvailabilitySettingQueue(
    apply: AutomaticAvailabilitySettingOperation,
): AutomaticAvailabilitySettingOperation {
    let queue: Promise<void> = Promise.resolve();
    return (enabled) => {
        const operation = queue.then(
            () => apply(enabled),
            () => apply(enabled),
        );
        queue = operation.catch(() => undefined);
        return operation;
    };
}

/** Applies one setting transaction and independently restores state after failure. */
export async function applyAutomaticAvailabilitySetting(
    enabled: boolean,
    dependencies: AutomaticAvailabilityLifecycleDependencies,
): Promise<void> {
    const previousEnabled = await dependencies.getEnabled();
    await dependencies.setEnabled(enabled);
    try {
        if (enabled) {
            await dependencies.enable();
        } else {
            await dependencies.disable();
        }
    } catch (originalError) {
        const restorationErrors: unknown[] = [];
        try {
            await dependencies.setEnabled(previousEnabled);
        } catch (error) {
            restorationErrors.push(error);
        }
        try {
            if (previousEnabled) {
                await dependencies.enable();
            } else {
                await dependencies.disable();
            }
        } catch (error) {
            restorationErrors.push(error);
        }
        if (restorationErrors.length > 0) {
            throw new AggregateError(
                [originalError, ...restorationErrors],
                'Unable to restore automatic availability consistently',
                { cause: originalError },
            );
        }
        throw originalError;
    }
}

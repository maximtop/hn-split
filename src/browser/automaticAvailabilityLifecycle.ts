export interface AutomaticAvailabilityLifecycleDependencies {
    getEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
    enable(): Promise<void>;
    disable(): Promise<void>;
}

export type AutomaticAvailabilitySettingOperation = (enabled: boolean) => Promise<void>;

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

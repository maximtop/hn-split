/**
 * Defines storage and effect operations for one background-owned setting.
 */
export interface SettingLifecycleDependencies {
    /**
     * Reads the authoritative persisted setting.
     */
    getEnabled(): Promise<boolean>;
    /**
     * Persists the authoritative setting value.
     * @param enabled - Whether the setting should be enabled.
     */
    setEnabled(enabled: boolean): Promise<void>;
    /**
     * Enables the setting's side effects.
     */
    enable(): Promise<void>;
    /**
     * Disables the setting's side effects and clears derived state.
     */
    disable(): Promise<void>;
}

/**
 * Represents one serialized setting operation.
 */
export type SettingOperation = (enabled: boolean) => Promise<void>;

/**
 * Creates a queue that serializes setting changes in request order.
 * @param apply - The setting operation to serialize.
 */
export function createSettingQueue(
    apply: SettingOperation,
): SettingOperation {
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

/**
 * Applies one setting transaction and independently restores state after failure.
 * @param enabled - Whether the setting should be enabled.
 * @param dependencies - The storage and effect operations used by the transaction.
 */
export async function applySettingTransaction(
    enabled: boolean,
    dependencies: SettingLifecycleDependencies,
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
                'Unable to restore the setting consistently',
                { cause: originalError },
            );
        }
        throw originalError;
    }
}

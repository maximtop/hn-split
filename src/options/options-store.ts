import { makeAutoObservable, runInAction } from 'mobx';

import { t } from '../shared/i18n';
import {
    AVAILABILITY_UPDATE_RESULT,
    readAutomaticAvailability,
    updateAutomaticAvailability,
} from './availability-settings';
import type { AvailabilitySettingsDependencies } from './availability-settings';

/**
 * Owns observable options-page state and delegates all persistence to the background worker.
 */
export class OptionsStore {
    enabled = false;
    busy = true;
    message = '';

    /**
     * Creates an observable options store.
     * @param dependencies - The background messaging operations used for setting reads and writes.
     */
    constructor(private readonly dependencies: AvailabilitySettingsDependencies) {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    /**
     * Loads the authoritative setting through a background message.
     */
    async load(): Promise<void> {
        this.busy = true;
        this.message = '';
        try {
            const enabled = await readAutomaticAvailability(this.dependencies);
            runInAction(() => {
                this.enabled = enabled;
            });
        } catch (error) {
            runInAction(() => {
                this.message = error instanceof Error ? error.message : t('unable_to_load_settings');
            });
        } finally {
            runInAction(() => {
                this.busy = false;
            });
        }
    }

    /**
     * Applies a setting mutation and resynchronizes after any rejected response.
     * @param nextEnabled - Whether automatic availability should be enabled.
     */
    async changeAutomaticAvailability(nextEnabled: boolean): Promise<void> {
        this.busy = true;
        this.message = '';
        try {
            const result = await updateAutomaticAvailability(nextEnabled, this.dependencies);
            runInAction(() => {
                this.enabled = result === AVAILABILITY_UPDATE_RESULT.ENABLED;
                this.message = result === AVAILABILITY_UPDATE_RESULT.ENABLED
                    ? t('automatic_enabled')
                    : t('automatic_disabled');
            });
        } catch (error) {
            const updateMessage = error instanceof Error ? error.message : t('unable_to_update_settings');
            try {
                const enabled = await readAutomaticAvailability(this.dependencies);
                runInAction(() => {
                    this.enabled = enabled;
                    this.message = updateMessage;
                });
            } catch (resyncError) {
                const resyncMessage = resyncError instanceof Error
                    ? resyncError.message
                    : t('unable_to_reload_settings');
                runInAction(() => {
                    this.message = `${updateMessage} ${resyncMessage}`;
                });
            }
        } finally {
            runInAction(() => {
                this.busy = false;
            });
        }
    }
}

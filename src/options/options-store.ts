import { makeAutoObservable, runInAction } from 'mobx';

import { userFacingMessage } from '../shared/error-messages';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/i18n';
import { logWarning } from '../shared/logger';
import {
    readAutomaticAvailability,
    updateAutomaticAvailability,
} from './availability-settings';
import type { AvailabilitySettingsDependencies } from './availability-settings';

/**
 * Names the localized confirmation copy shown after a successful mutation.
 */
export interface SettingStatusCopy {
    /**
     * Contains the locale key confirming the setting was enabled.
     */
    enabledKey: MessageKey;
    /**
     * Contains the locale key confirming the setting was disabled.
     */
    disabledKey: MessageKey;
}

/**
 * Owns observable options-page state for one background-owned toggle and
 * delegates all persistence to the background worker.
 */
export class OptionsStore {
    enabled = false;
    busy = true;
    message = '';

    /**
     * Creates an observable options store.
     * @param dependencies - The background messaging operations used for setting reads and writes.
     * @param copy - The localized confirmation copy for this setting.
     */
    constructor(
        private readonly dependencies: AvailabilitySettingsDependencies,
        private readonly copy: SettingStatusCopy,
    ) {
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
            logWarning('loading the setting failed.', error);
            runInAction(() => {
                this.message = userFacingMessage(error, 'unable_to_load_settings');
            });
        } finally {
            runInAction(() => {
                this.busy = false;
            });
        }
    }

    /**
     * Applies a setting mutation and resynchronizes after any rejected response.
     * @param nextEnabled - Whether the setting should be enabled.
     */
    async changeEnabled(nextEnabled: boolean): Promise<void> {
        this.busy = true;
        this.message = '';
        try {
            const enabled = await updateAutomaticAvailability(nextEnabled, this.dependencies);
            runInAction(() => {
                this.enabled = enabled;
                this.message = enabled ? t(this.copy.enabledKey) : t(this.copy.disabledKey);
            });
        } catch (error) {
            logWarning('updating the setting failed.', error);
            const updateMessage = userFacingMessage(error, 'unable_to_update_settings');
            try {
                const enabled = await readAutomaticAvailability(this.dependencies);
                runInAction(() => {
                    this.enabled = enabled;
                    this.message = updateMessage;
                });
            } catch (resyncError) {
                logWarning('reloading the setting failed.', resyncError);
                const resyncMessage = userFacingMessage(resyncError, 'unable_to_reload_settings');
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

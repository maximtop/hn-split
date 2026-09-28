import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    UserFacingError,
    messageKeyForBackgroundError,
    userFacingMessage,
} from '../src/shared/error-messages';
import { t } from '../src/shared/i18n';
import { BACKGROUND_ERROR_CODE } from '../src/shared/messages';

describe('messageKeyForBackgroundError', () => {
    it.each([
        [BACKGROUND_ERROR_CODE.LOOKUP_REQUEST_FAILED, 'lookup_error'],
        [BACKGROUND_ERROR_CODE.OPEN_DISCUSSION_FAILED, 'open_discussion_failed'],
        [BACKGROUND_ERROR_CODE.SETTING_READ_FAILED, 'unable_to_load_settings'],
        [BACKGROUND_ERROR_CODE.SETTING_UPDATE_FAILED, 'unable_to_update_settings'],
        [BACKGROUND_ERROR_CODE.SIDE_PANEL_SELECTION_FAILED, 'side_panel_empty'],
    ] as const)('maps %s to the %s locale key', (code, expectedKey) => {
        expect(messageKeyForBackgroundError(code)).toBe(expectedKey);
    });
});

describe('userFacingMessage', () => {
    it('returns a UserFacingError message unchanged', () => {
        const error = new UserFacingError('Choose a discussion in the extension popup.');

        expect(userFacingMessage(error, 'unable_to_load_settings')).toBe(
            'Choose a discussion in the extension popup.',
        );
    });

    it('hides a plain Error message behind the translated fallback', () => {
        const error = new Error('raw diagnostic text: stack trace at internal.js:42');

        const result = userFacingMessage(error, 'unable_to_load_settings');

        expect(result).toBe(t('unable_to_load_settings'));
        expect(result).not.toContain('raw diagnostic text');
        expect(result).not.toContain('internal.js');
    });

    it('hides an arbitrary thrown string behind the translated fallback', () => {
        const result = userFacingMessage('secret diagnostic string', 'unable_to_update_settings');

        expect(result).toBe(t('unable_to_update_settings'));
        expect(result).not.toContain('secret diagnostic string');
    });

    it('hides an arbitrary thrown undefined behind the translated fallback', () => {
        const result = userFacingMessage(undefined, 'unable_to_reload_settings');

        expect(result).toBe(t('unable_to_reload_settings'));
    });
});

describe('UserFacingError', () => {
    it('is a real Error subclass distinguishable via instanceof', () => {
        const error = new UserFacingError('localized copy');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(UserFacingError);
        expect(error.message).toBe('localized copy');
        expect(error.name).toBe('Error');
    });

    it('does not classify a plain Error as a UserFacingError', () => {
        const error = new Error('localized copy');

        expect(error).not.toBeInstanceOf(UserFacingError);
    });
});

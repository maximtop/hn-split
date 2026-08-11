import { describe, expect, it, vi } from 'vitest';

import {
    readBooleanSetting,
    updateBooleanSetting,
} from '../src/options/setting-client';
import type { BooleanSettingDependencies } from '../src/options/setting-client';

/**
 * Creates deterministic background operations for one boolean setting.
 */
function dependencies(): BooleanSettingDependencies {
    return {
        readCurrent: vi.fn(async () => ({ ok: true, result: { enabled: false } })),
        requestUpdate: vi.fn(async (enabled: boolean) => ({ ok: true, result: { enabled } })),
    };
}

describe('boolean setting client', () => {
    it('reads the authoritative setting through the background client', async () => {
        const deps = dependencies();

        await expect(readBooleanSetting(deps)).resolves.toBe(false);

        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });

    it('returns the authoritative boolean from the background-owned setting operation', async () => {
        const deps = dependencies();

        await expect(updateBooleanSetting(true, deps)).resolves.toBe(true);

        expect(deps.requestUpdate).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('does not send a stale compensating value when the request rejects', async () => {
        const deps = dependencies();
        vi.mocked(deps.requestUpdate).mockRejectedValue(new Error('worker unavailable'));

        await expect(updateBooleanSetting(true, deps)).rejects.toThrow('worker unavailable');

        expect(deps.requestUpdate).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('translates a stable background error code into localized copy', async () => {
        const deps = dependencies();
        vi.mocked(deps.requestUpdate).mockResolvedValue({ ok: false, error: 'setting_read_failed' });

        await expect(updateBooleanSetting(false, deps))
            .rejects.toThrow('Unable to load settings.');
    });

    it.each([
        undefined,
        null,
        {},
        { ok: true },
        { ok: true, result: { status: 'updated' } },
        { ok: false, error: 'badge refresh failed' },
    ])('rejects malformed or unknown responses with localized fallback copy %#', async (response) => {
        const deps = dependencies();
        vi.mocked(deps.requestUpdate).mockResolvedValue(response);

        await expect(updateBooleanSetting(false, deps))
            .rejects.toThrow('Unable to update settings.');

        expect(deps.requestUpdate).toHaveBeenCalledExactlyOnceWith(false);
    });
});

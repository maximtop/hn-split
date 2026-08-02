import { describe, expect, it, vi } from 'vitest';

import {
    readAutomaticAvailability,
    updateAutomaticAvailability,
} from '../src/options/availability-settings';
import type { AvailabilitySettingsDependencies } from '../src/options/availability-settings';

function dependencies(): AvailabilitySettingsDependencies {
    return {
        readCurrent: vi.fn(async () => ({ ok: true, result: { enabled: false } })),
        notifyChanged: vi.fn(async (enabled: boolean) => ({ ok: true, result: { enabled } })),
    };
}

describe('updateAutomaticAvailability', () => {
    it('reads the authoritative setting through the background client', async () => {
        const deps = dependencies();

        await expect(readAutomaticAvailability(deps)).resolves.toBe(false);

        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });

    it('enables automatic checks through the background-owned setting operation', async () => {
        const deps = dependencies();

        await expect(updateAutomaticAvailability(true, deps)).resolves.toBe('enabled');

        expect(deps.notifyChanged).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('does not send a stale compensating value when notification rejects', async () => {
        const deps = dependencies();
        vi.mocked(deps.notifyChanged).mockRejectedValue(new Error('worker unavailable'));

        await expect(updateAutomaticAvailability(true, deps)).rejects.toThrow('worker unavailable');

        expect(deps.notifyChanged).toHaveBeenCalledExactlyOnceWith(true);
    });

    it.each([
        undefined,
        null,
        {},
        { ok: true },
        { ok: true, result: { status: 'updated' } },
        { ok: false, error: 'badge refresh failed' },
    ])('rejects malformed or unsuccessful response without client-side compensation %#', async (response) => {
        const deps = dependencies();
        vi.mocked(deps.notifyChanged).mockResolvedValue(response);

        await expect(updateAutomaticAvailability(false, deps))
            .rejects.toThrow(response !== null && typeof response === 'object' && 'error' in response
                ? 'badge refresh failed'
                : 'Background did not confirm the setting change');

        expect(deps.notifyChanged).toHaveBeenCalledExactlyOnceWith(false);
    });
});

import { describe, expect, it, vi } from 'vitest';

import { OptionsStore } from '../src/options/options-store';
import type { AvailabilitySettingsDependencies } from '../src/options/availability-settings';

function dependencies(): AvailabilitySettingsDependencies {
    return {
        readCurrent: vi.fn(async () => ({ ok: true, result: { enabled: false } })),
        notifyChanged: vi.fn(async (enabled: boolean) => ({ ok: true, result: { enabled } })),
    };
}

describe('OptionsStore', () => {
    it('loads the authoritative setting through the background client', async () => {
        const deps = dependencies();
        const store = new OptionsStore(deps);

        await store.load();

        expect(store.enabled).toBe(false);
        expect(store.busy).toBe(false);
        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });

    it('updates observable state after a confirmed background mutation', async () => {
        const deps = dependencies();
        const store = new OptionsStore(deps);

        await store.changeAutomaticAvailability(true);

        expect(store.enabled).toBe(true);
        expect(store.busy).toBe(false);
        expect(store.message).not.toBe('');
        expect(deps.notifyChanged).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('resynchronizes through the background client after an invalid mutation response', async () => {
        const deps = dependencies();
        vi.mocked(deps.readCurrent).mockResolvedValue({ ok: true, result: { enabled: true } });
        vi.mocked(deps.notifyChanged).mockResolvedValue({ ok: true });
        const store = new OptionsStore(deps);

        await store.changeAutomaticAvailability(false);

        expect(store.enabled).toBe(true);
        expect(store.busy).toBe(false);
        expect(store.message).not.toBe('');
        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });
});

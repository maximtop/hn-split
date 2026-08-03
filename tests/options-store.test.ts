import { describe, expect, it, vi } from 'vitest';

import { OptionsStore } from '../src/options/options-store';
import type { SettingStatusCopy } from '../src/options/options-store';
import type { AvailabilitySettingsDependencies } from '../src/options/availability-settings';

function dependencies(): AvailabilitySettingsDependencies {
    return {
        readCurrent: vi.fn(async () => ({ ok: true, result: { enabled: false } })),
        requestUpdate: vi.fn(async (enabled: boolean) => ({ ok: true, result: { enabled } })),
    };
}

const COPY: SettingStatusCopy = {
    enabledKey: 'automatic_enabled',
    disabledKey: 'automatic_disabled',
};

describe('OptionsStore', () => {
    it('loads the authoritative setting through the background client', async () => {
        const deps = dependencies();
        const store = new OptionsStore(deps, COPY);

        await store.load();

        expect(store.enabled).toBe(false);
        expect(store.busy).toBe(false);
        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });

    it('updates observable state after a confirmed background mutation', async () => {
        const deps = dependencies();
        const store = new OptionsStore(deps, COPY);

        await store.changeEnabled(true);

        expect(store.enabled).toBe(true);
        expect(store.busy).toBe(false);
        expect(store.message).not.toBe('');
        expect(deps.requestUpdate).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('resynchronizes through the background client after an invalid mutation response', async () => {
        const deps = dependencies();
        vi.mocked(deps.readCurrent).mockResolvedValue({ ok: true, result: { enabled: true } });
        vi.mocked(deps.requestUpdate).mockResolvedValue({ ok: true });
        const store = new OptionsStore(deps, COPY);

        await store.changeEnabled(false);

        expect(store.enabled).toBe(true);
        expect(store.busy).toBe(false);
        expect(store.message).not.toBe('');
        expect(deps.readCurrent).toHaveBeenCalledOnce();
    });

    it('confirms with the injected copy keys of this setting', async () => {
        const deps = dependencies();
        const store = new OptionsStore(deps, {
            enabledKey: 'article_click_open_enabled',
            disabledKey: 'article_click_open_disabled',
        });

        await store.changeEnabled(true);
        const enabledMessage = store.message;
        await store.changeEnabled(false);

        expect(enabledMessage).not.toBe('');
        expect(store.message).not.toBe('');
        expect(store.message).not.toBe(enabledMessage);
    });
});

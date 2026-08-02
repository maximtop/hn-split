import { describe, expect, it, vi } from 'vitest';

import {
    applyAutomaticAvailabilitySetting,
    createAutomaticAvailabilitySettingQueue,
} from '../src/browser/automatic-availability-lifecycle';
import type { AutomaticAvailabilityLifecycleDependencies } from '../src/browser/automatic-availability-lifecycle';

function dependencies(enabled: boolean): AutomaticAvailabilityLifecycleDependencies {
    return {
        getEnabled: vi.fn(async () => enabled),
        setEnabled: vi.fn(async () => undefined),
        enable: vi.fn(async () => undefined),
        disable: vi.fn(async () => undefined),
    };
}

describe('applyAutomaticAvailabilitySetting', () => {
    it('persists and applies an enabled setting in the background', async () => {
        const deps = dependencies(false);

        await applyAutomaticAvailabilitySetting(true, deps);

        expect(deps.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
        expect(deps.enable).toHaveBeenCalledOnce();
        expect(deps.disable).not.toHaveBeenCalled();
    });

    it('restores disabled state and effects when enabling fails after partial work', async () => {
        const deps = dependencies(false);
        vi.mocked(deps.enable).mockRejectedValueOnce(new Error('tab closed'));

        await expect(applyAutomaticAvailabilitySetting(true, deps)).rejects.toThrow('tab closed');

        expect(deps.setEnabled).toHaveBeenNthCalledWith(1, true);
        expect(deps.setEnabled).toHaveBeenNthCalledWith(2, false);
        expect(deps.disable).toHaveBeenCalledOnce();
    });

    it('restores enabled state and effects when disabling fails after partial work', async () => {
        const deps = dependencies(true);
        vi.mocked(deps.disable).mockRejectedValueOnce(new Error('cache unavailable'));

        await expect(applyAutomaticAvailabilitySetting(false, deps)).rejects.toThrow('cache unavailable');

        expect(deps.setEnabled).toHaveBeenNthCalledWith(1, false);
        expect(deps.setEnabled).toHaveBeenNthCalledWith(2, true);
        expect(deps.enable).toHaveBeenCalledOnce();
    });

    it('still compensates effects when restoring storage fails', async () => {
        const deps = dependencies(false);
        vi.mocked(deps.enable).mockRejectedValueOnce(new Error('enable failed'));
        vi.mocked(deps.setEnabled)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('restore failed'));

        await expect(applyAutomaticAvailabilitySetting(true, deps))
            .rejects.toThrow('Unable to restore automatic availability consistently');

        expect(deps.disable).toHaveBeenCalledOnce();
    });

    it('reports effect-compensation failure instead of swallowing it', async () => {
        const deps = dependencies(false);
        vi.mocked(deps.enable).mockRejectedValueOnce(new Error('enable failed'));
        vi.mocked(deps.disable).mockRejectedValueOnce(new Error('disable compensation failed'));

        await expect(applyAutomaticAvailabilitySetting(true, deps))
            .rejects.toThrow('Unable to restore automatic availability consistently');
    });

    it('serializes concurrent opposite setting changes', async () => {
        const order: string[] = [];
        let releaseEnable!: () => void;
        const enableGate = new Promise<void>((resolve) => {
            releaseEnable = resolve;
        });
        const queued = createAutomaticAvailabilitySettingQueue(async (enabled) => {
            order.push(`start:${enabled}`);
            if (enabled) {
                await enableGate;
            }
            order.push(`end:${enabled}`);
        });

        const enable = queued(true);
        await vi.waitFor(() => expect(order).toEqual(['start:true']));
        const disable = queued(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(order).toEqual(['start:true']);

        releaseEnable();
        await Promise.all([enable, disable]);
        expect(order).toEqual(['start:true', 'end:true', 'start:false', 'end:false']);
    });
});

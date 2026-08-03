import { describe, expect, it, vi } from 'vitest';

import { refreshTabsBounded } from '../src/browser/bounded-tab-refresh';
import type { TabRefreshTarget } from '../src/browser/bounded-tab-refresh';

const targets = (count: number): TabRefreshTarget[] => Array.from(
    { length: count },
    (_unused, index) => ({ tabId: index + 1, url: `https://example.com/${index + 1}` }),
);

describe('refreshTabsBounded', () => {
    it('processes every target while never exceeding the concurrency bound', async () => {
        let active = 0;
        let maximumActive = 0;
        const refresh = vi.fn(async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 0));
            active -= 1;
        });

        const failures = await refreshTabsBounded(targets(9), refresh, 3);

        expect(refresh).toHaveBeenCalledTimes(9);
        expect(maximumActive).toBeLessThanOrEqual(3);
        expect(failures).toEqual([]);
    });

    it('collects failures without stopping the remaining refreshes', async () => {
        const refresh = vi.fn(async (tabId: number) => {
            if (tabId % 2 === 0) {
                throw new Error(`tab ${tabId} failed`);
            }
        });

        const failures = await refreshTabsBounded(targets(4), refresh, 2);

        expect(refresh).toHaveBeenCalledTimes(4);
        expect(failures).toHaveLength(2);
    });

    it('completes immediately for an empty target list', async () => {
        const refresh = vi.fn(async () => undefined);

        await expect(refreshTabsBounded([], refresh, 4)).resolves.toEqual([]);
        expect(refresh).not.toHaveBeenCalled();
    });
});

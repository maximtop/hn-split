/**
 * @file Playwright configuration for the end-to-end suite. Runs the `*.e2e.ts` files under `tests/e2e` serially in
 * one worker with the line reporter, and retains traces only for failed tests.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.e2e.ts',
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    workers: 1,
    reporter: 'line',
    use: {
        trace: 'retain-on-failure',
    },
});

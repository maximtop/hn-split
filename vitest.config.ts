/**
 * @file Vitest configuration. Runs unit tests in a jsdom environment with the shared setup from `tests/setup.ts`
 * and collects V8 coverage over the TypeScript sources under `src`.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts', 'src/**/*.tsx'],
        },
    },
});

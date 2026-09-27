import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const RENDER_SCRIPT = resolve(import.meta.dirname, '../scripts/render-store-listing.mjs');

describe('store listing renderer', () => {
    it('prints only Chrome dashboard text fields and manifest verification copy', () => {
        const output = execFileSync(process.execPath, [RENDER_SCRIPT, 'chrome', 'en'], {
            encoding: 'utf8',
        });

        expect(output).toContain('## Name (from manifest; read-only)');
        expect(output).toContain('## Summary / short description (from manifest; read-only)');
        expect(output).toContain('## Detailed description (paste into dashboard)');
        expect(output.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(9);
        expect(output).not.toContain('## Release notes');
        expect(output).not.toContain('## Screenshot captions');
    });

    it('retains version notes for stores that expose them', () => {
        const output = execFileSync(process.execPath, [RENDER_SCRIPT, 'appStore', 'en'], {
            encoding: 'utf8',
        });

        expect(output).toContain('## Release notes v0.1.0');
        expect(output).toContain('## Keywords');
        expect(output).not.toContain('## Screenshot captions');
    });

    it('reports an unsupported store/locale combination and exits 0', () => {
        const result = spawnSync(process.execPath, [RENDER_SCRIPT, 'appStore', 'bg'], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('App Store (Safari) has no bg listing');
        expect(result.stdout).toContain('that audience sees the en-US listing');
    });

    it('exits 1 for missing or invalid arguments', () => {
        const missingArguments = spawnSync(process.execPath, [RENDER_SCRIPT], { encoding: 'utf8' });
        expect(missingArguments.status).toBe(1);
        expect(missingArguments.stderr).toContain('Usage: pnpm store:render');

        const invalidStore = spawnSync(process.execPath, [RENDER_SCRIPT, 'bogus', 'en'], { encoding: 'utf8' });
        expect(invalidStore.status).toBe(1);
        expect(invalidStore.stderr).toContain('Usage: pnpm store:render');
    });
});

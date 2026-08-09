import { execFileSync } from 'node:child_process';
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
});

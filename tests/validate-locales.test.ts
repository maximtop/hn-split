import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const VALIDATE_SCRIPT = resolve(import.meta.dirname, '../scripts/validate-locales.mjs');

describe('validate-locales CLI', () => {
    it('exits 0 for the current repository content', () => {
        const output = execFileSync(process.execPath, [VALIDATE_SCRIPT], {
            encoding: 'utf8',
        });

        expect(output).toContain('Validated 40 registered locales against en');
        expect(output).toContain('shipping');
    });
});

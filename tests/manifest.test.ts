import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension permissions', () => {
    it('installs tabs as a required permission and declares no optional permissions', async () => {
        const manifest = JSON.parse(await readFile(
            resolve(import.meta.dirname, '../public/manifest.json'),
            'utf8',
        )) as Record<string, unknown>;

        expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs']));
        expect(manifest).not.toHaveProperty('optional_permissions');
    });
});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
    it('installs tabs as a required permission and declares no optional permissions', async () => {
        const manifest = JSON.parse(await readFile(
            resolve(import.meta.dirname, '../public/manifest.json'),
            'utf8',
        )) as Record<string, unknown>;

        expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs']));
        expect(manifest).not.toHaveProperty('optional_permissions');
    });

    it('requires Chrome 140 and uses localized popup metadata', async () => {
        const manifest = JSON.parse(await readFile(
            resolve(import.meta.dirname, '../public/manifest.json'),
            'utf8',
        )) as Record<string, unknown>;

        expect(manifest.minimum_chrome_version).toBe('140');
        expect(manifest.default_locale).toBe('en');
        expect(manifest.name).toBe('__MSG_extension_name__');
        expect(manifest.action).toMatchObject({ default_popup: 'popup.html' });
    });
});

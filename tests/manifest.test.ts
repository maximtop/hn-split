import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface InstalledManifest {
    permissions: string[];
    host_permissions: string[];
    [key: string]: unknown;
}

const readManifest = async (): Promise<InstalledManifest> => JSON.parse(await readFile(
    resolve(import.meta.dirname, '../public/manifest.json'),
    'utf8',
)) as InstalledManifest;

describe('extension manifest', () => {
    it('installs exactly the documented permission set and no optional permissions', async () => {
        const manifest = await readManifest();

        expect([...manifest.permissions].sort()).toEqual([
            'activeTab',
            'contextMenus',
            'declarativeNetRequestWithHostAccess',
            'scripting',
            'sidePanel',
            'storage',
            'tabs',
        ]);
        expect(manifest.host_permissions).toEqual([
            'https://hn.algolia.com/*',
            'https://news.ycombinator.com/*',
        ]);
        expect(manifest).not.toHaveProperty('optional_permissions');
        expect(manifest).not.toHaveProperty('optional_host_permissions');
    });

    it('requires Chrome 140 and uses localized popup metadata', async () => {
        const manifest = await readManifest();

        expect(manifest.minimum_chrome_version).toBe('140');
        expect(manifest.default_locale).toBe('en');
        expect(manifest.name).toBe('__MSG_extension_name__');
        expect(manifest.action).toMatchObject({ default_popup: 'popup.html' });
    });

    it('declares the full icon set and every referenced icon file exists', async () => {
        const manifest = await readManifest();
        const expectedSizes = ['16', '32', '48', '128'];

        const icons = manifest.icons as Record<string, string>;
        const actionIcons = (manifest.action as { default_icon: Record<string, string> }).default_icon;
        expect(Object.keys(icons).sort()).toEqual([...expectedSizes].sort());
        expect(actionIcons).toEqual(icons);
        for (const size of expectedSizes) {
            const iconPath = `icons/icon-${size}.png`;
            expect(icons[size]).toBe(iconPath);
            // Chrome refuses to load an unpacked extension whose manifest
            // references a missing icon file, so existence is part of the
            // manifest contract.
            await expect(access(resolve(import.meta.dirname, '../public', iconPath))).resolves.toBeUndefined();
        }
    });

    it('documents every installed permission in the PRIVACY.md permissions section', async () => {
        const manifest = await readManifest();
        const privacy = await readFile(resolve(import.meta.dirname, '../PRIVACY.md'), 'utf8');

        // Expectations derive from the manifest, so adding a permission without
        // documenting it in the dedicated section fails here. The check is
        // one-way by design: prose about a permission that was later removed is
        // caught by the exact-set test above plus review, not by this test.
        const sectionStart = privacy.indexOf('## Permissions');
        expect(sectionStart).toBeGreaterThanOrEqual(0);
        const followingHeading = privacy.indexOf('\n## ', sectionStart + 1);
        const permissionsSection = privacy.slice(
            sectionStart,
            followingHeading === -1 ? undefined : followingHeading,
        );
        for (const permission of manifest.permissions) {
            expect(permissionsSection).toContain(`\`${permission}\``);
        }
        for (const host of manifest.host_permissions) {
            expect(permissionsSection).toContain(host);
        }
    });
});

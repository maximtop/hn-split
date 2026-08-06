import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    BUILD_TARGETS,
    DEFAULT_BUILD_TARGET,
    EXTENSION_VERSION_PATTERN,
    FIREFOX_GECKO_ID,
    FIREFOX_STRICT_MIN_VERSION,
    buildManifest,
    parseBuildTarget,
    serializeManifest,
} from '../scripts/lib/browser-manifest.ts';
import { readPackageVersion } from '../scripts/lib/build-info.ts';

const ROOT = resolve(import.meta.dirname, '..');

const readBaseManifest = async (): Promise<Record<string, unknown>> => JSON.parse(
    await readFile(resolve(ROOT, 'public/manifest.json'), 'utf8'),
) as Record<string, unknown>;

describe('parseBuildTarget', () => {
    it('defaults to chrome when the environment leaves the target unset', () => {
        expect(parseBuildTarget(undefined)).toBe(DEFAULT_BUILD_TARGET);
        expect(parseBuildTarget('')).toBe(DEFAULT_BUILD_TARGET);
    });

    it('accepts every declared target and rejects anything else', () => {
        for (const target of BUILD_TARGETS) {
            expect(parseBuildTarget(target)).toBe(target);
        }
        expect(() => parseBuildTarget('safari')).toThrow(/Unknown build target/);
    });
});

describe('buildManifest', () => {
    it('keeps the base manifest version-free so package.json stays the single source', async () => {
        const base = await readBaseManifest();

        expect(base).not.toHaveProperty('version');
        expect(readPackageVersion(ROOT)).toMatch(EXTENSION_VERSION_PATTERN);
    });

    it('injects the version into every target without mutating the base', async () => {
        const base = await readBaseManifest();

        for (const target of BUILD_TARGETS) {
            const manifest = buildManifest(base, target, '9.8.7');
            expect(manifest['version']).toBe('9.8.7');
        }
        expect(base).not.toHaveProperty('version');
    });

    it('rejects versions that are not three dot-separated integers', async () => {
        const base = await readBaseManifest();

        for (const version of ['1.2', '1.2.3.4', '1.2.3-beta', 'v1.2.3']) {
            expect(() => buildManifest(base, 'chrome', version)).toThrow(/three dot-separated integers/);
        }
    });

    it('produces identical chrome and edge manifests until the store pipelines diverge', async () => {
        const base = await readBaseManifest();

        expect(buildManifest(base, 'edge', '1.0.0')).toEqual(buildManifest(base, 'chrome', '1.0.0'));
    });

    it('keeps the chrome manifest identical to the base apart from the version', async () => {
        const base = await readBaseManifest();

        const manifest = buildManifest(base, 'chrome', '1.0.0');
        expect(manifest).toEqual({ ...base, version: '1.0.0' });
    });

    it('rewrites the firefox manifest for event pages and drops Chrome-only keys', async () => {
        const base = await readBaseManifest();
        const baseBackground = base['background'] as { service_worker: string };
        const basePermissions = base['permissions'] as string[];

        const manifest = buildManifest(base, 'firefox', '1.0.0');

        expect(manifest['background']).toEqual({ scripts: [baseBackground.service_worker] });
        expect(manifest).not.toHaveProperty('minimum_chrome_version');
        expect(manifest).not.toHaveProperty('side_panel');
        expect(manifest['permissions']).toEqual(basePermissions.filter((permission) => permission !== 'sidePanel'));
        expect(manifest).not.toHaveProperty('options_page');
        expect(manifest['options_ui']).toEqual({
            page: base['options_page'],
            open_in_tab: true,
        });
        expect(manifest['browser_specific_settings']).toEqual({
            gecko: {
                id: FIREFOX_GECKO_ID,
                strict_min_version: FIREFOX_STRICT_MIN_VERSION,
                data_collection_permissions: { required: ['none'] },
            },
        });
    });

    it('refuses a base manifest without a service worker instead of guessing', () => {
        expect(() => buildManifest({ background: {} }, 'firefox', '1.0.0'))
            .toThrow(/background\.service_worker/);
    });
});

describe('serializeManifest', () => {
    it('emits two-space-indented JSON with a trailing newline that parses back', () => {
        const serialized = serializeManifest({ manifest_version: 3 });

        expect(serialized.endsWith('\n')).toBe(true);
        expect(serialized).toContain('  "manifest_version": 3');
        expect(JSON.parse(serialized)).toEqual({ manifest_version: 3 });
    });
});

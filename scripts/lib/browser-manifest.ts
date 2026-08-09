/**
 * Store packaging targets. Chrome is the runtime MVP; the Edge and Firefox
 * artifacts exist so store submissions never depend on local untracked steps
 * (see docs/release.md). Runtime support beyond Chrome is tracked separately.
 */
export const BUILD_TARGETS = ['chrome', 'edge', 'firefox'] as const;

/**
 * One packaged browser target.
 */
export type BuildTarget = (typeof BUILD_TARGETS)[number];

/**
 * Target used when a build does not specify one, matching the documented
 * `pnpm build` → Chrome development flow.
 */
export const DEFAULT_BUILD_TARGET: BuildTarget = 'chrome';

/**
 * Gecko add-on id for Firefox packages, rooted in the maintainer's domain
 * (maximtop.dev). AMO treats this id as the permanent identity of the
 * extension, so it must never change once published.
 */
export const FIREFOX_GECKO_ID = 'hn-split@maximtop.dev';

/**
 * Oldest supported Firefox version. Firefox 140 adds the built-in consent
 * experience required by the declared data-collection permissions; it also
 * ships every WebExtension API used by the Firefox package.
 */
export const FIREFOX_STRICT_MIN_VERSION = '140.0';

/**
 * Data sent outside Firefox for the extension's required discussion lookup.
 * The active page URL is browsing activity, while canonical and user-selected
 * links read from page content are website content under Mozilla's taxonomy.
 */
export const FIREFOX_REQUIRED_DATA_COLLECTION_PERMISSIONS = [
    'browsingActivity',
    'websiteContent',
] as const;

/**
 * Store-facing version string shape shared by package.json and every
 * generated manifest: three dot-separated integers.
 */
export const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * The subset of manifest keys the per-browser transforms read or rewrite.
 * Everything else passes through untouched.
 */
interface ExtensionManifest {
    /**
     * Version injected from package.json; the base manifest omits it so the
     * package version stays the single source of truth.
     */
    version?: string;

    /**
     * Chromium version floor; meaningless to Firefox and removed there.
     */
    minimum_chrome_version?: string;

    /**
     * Declared API permissions.
     */
    permissions?: string[];

    /**
     * Background entry point; Chrome uses a service worker, Firefox an event
     * page built from the same bundle.
     */
    background?: {
        /**
         * Bundle file registered as the MV3 service worker.
         */
        service_worker?: string;

        /**
         * Remaining background keys such as `type`.
         */
        [key: string]: unknown;
    };

    /**
     * Chrome side panel declaration; Firefox has no equivalent API.
     */
    side_panel?: unknown;

    /**
     * Chrome-style options page reference.
     */
    options_page?: string;

    /**
     * Cross-browser options declaration generated for Firefox.
     */
    options_ui?: unknown;

    /**
     * Firefox-specific settings such as the gecko id.
     */
    browser_specific_settings?: unknown;

    /**
     * Keys the transforms do not touch.
     */
    [key: string]: unknown;
}

/**
 * Resolves the `TARGET_BROWSER` environment value into a build target.
 *
 * @param value Raw environment value; `undefined` or empty selects the
 * default Chrome target.
 * @returns The validated build target.
 */
export function parseBuildTarget(value: string | undefined): BuildTarget {
    if (value === undefined || value === '') {
        return DEFAULT_BUILD_TARGET;
    }
    if ((BUILD_TARGETS as readonly string[]).includes(value)) {
        return value as BuildTarget;
    }
    throw new Error(
        `Unknown build target "${value}"; expected one of: ${BUILD_TARGETS.join(', ')}.`,
    );
}

/**
 * Rewrites the Chrome-shaped base manifest for Firefox. Firefox runs the
 * background bundle as an MV3 event page, has no side panel API, requires
 * `options_ui`, and needs `browser_specific_settings.gecko`, including the
 * AMO disclosure for the URL candidates sent to the lookup API.
 *
 * @param manifest Cloned manifest mutated in place.
 */
function applyFirefoxTransform(manifest: ExtensionManifest): void {
    const serviceWorker = manifest.background?.service_worker;
    if (typeof serviceWorker !== 'string') {
        throw new Error('The base manifest must declare background.service_worker.');
    }
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: [serviceWorker] };
    if (manifest.permissions !== undefined) {
        manifest.permissions = manifest.permissions.filter((permission) => permission !== 'sidePanel');
    }
    delete manifest.side_panel;
    const optionsPage = manifest.options_page;
    if (typeof optionsPage === 'string') {
        manifest.options_ui = {
            page: optionsPage,
            open_in_tab: true,
        };
        delete manifest.options_page;
    }
    manifest.browser_specific_settings = {
        gecko: {
            id: FIREFOX_GECKO_ID,
            strict_min_version: FIREFOX_STRICT_MIN_VERSION,
            data_collection_permissions: {
                required: [...FIREFOX_REQUIRED_DATA_COLLECTION_PERMISSIONS],
            },
        },
    };
}

/**
 * Produces the manifest for one build target from the shared base manifest.
 * Chrome and Edge intentionally share one manifest shape today; Edge exists
 * as a separate artifact so the two store pipelines can diverge later
 * without renaming anything.
 *
 * @param base Parsed public/manifest.json content; never mutated.
 * @param target Browser target to generate for.
 * @param version Version taken from package.json.
 * @returns A new manifest object ready for serialization.
 */
export function buildManifest(
    base: Record<string, unknown>,
    target: BuildTarget,
    version: string,
): Record<string, unknown> {
    if (!EXTENSION_VERSION_PATTERN.test(version)) {
        throw new Error(`Version "${version}" must be three dot-separated integers.`);
    }
    const manifest = structuredClone(base) as ExtensionManifest;
    manifest.version = version;
    if (target === 'firefox') {
        applyFirefoxTransform(manifest);
    }
    return manifest;
}

/**
 * Serializes a manifest with the repository's JSON formatting so generated
 * manifests stay byte-stable across builds.
 *
 * @param manifest Manifest object to serialize.
 * @returns Two-space-indented JSON with a trailing newline.
 */
export function serializeManifest(manifest: Record<string, unknown>): string {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}

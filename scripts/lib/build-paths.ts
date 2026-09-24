import { resolve } from 'node:path';

import { parseBuildTarget } from './browser-manifest.ts';

/**
 * Channels whose output locations are owned by the build pipeline.
 */
export const BUILD_CHANNELS = { DEV: 'dev', RELEASE: 'release' } as const;

/**
 * Resolves a validated browser build below the repository build directory.
 *
 * @param root Repository root directory.
 * @param target Browser name, defaulting to Chrome.
 * @param channel Development output or store release output.
 *
 * @returns Absolute unpacked extension directory.
 */
export function resolveBuildPath(
    root: string,
    target: string | undefined,
    channel: string = BUILD_CHANNELS.DEV,
): string {
    if (channel !== BUILD_CHANNELS.DEV && channel !== BUILD_CHANNELS.RELEASE) {
        throw new Error(`Unknown build channel "${channel}"; expected dev or release.`);
    }
    const browser = parseBuildTarget(target);
    return channel === BUILD_CHANNELS.RELEASE
        ? resolve(root, 'build/release', browser)
        : resolve(root, 'build', browser);
}

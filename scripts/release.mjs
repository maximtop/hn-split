// Builds the store packages: every browser target into build/release/<target>
// with a zip of it next to it, build/release/<target>.zip. The release
// workflow renames the zips, adds the source archive and the checksums; see
// docs/RELEASE.md.

// fflate stores zip timestamps as local time, so the process timezone must
// be pinned before any timestamp conversion. Imports are safe to hoist above
// this line because none of them read the clock at load time.
process.env.TZ = 'UTC';

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
    CHROME_PACKAGED_LOCALE_ALIASES,
    CHROME_PACKAGED_LOCALES,
    SHIPPED_LOCALES,
} from '../src/shared/locales.ts';
import { BUILD_CHANNELS, resolveBuildPath } from './lib/build-paths.ts';
import { BUILD_TARGETS, parseBuildTarget } from './lib/browser-manifest.ts';
import { readHeadCommit } from './lib/build-info.ts';
import { collectDirectoryEntries, createDeterministicZip } from './lib/deterministic-zip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const RELEASE_DIR = resolve(ROOT, 'build/release');
const args = process.argv.slice(2);
if (args.length > 1) {
    throw new Error('Choose at most one browser: chrome, edge or firefox.');
}
const targets = args.length === 0 ? BUILD_TARGETS : [parseBuildTarget(args[0])];

// Zip entry timestamps derive from the packaged commit, never from the clock,
// so rebuilding the same commit reproduces identical bytes.
const entryTimestamp = new Date(readHeadCommit(ROOT).timestamp * 1000);

/**
 * Builds one browser target with rspack into build/release/<target>.
 *
 * @param target Browser target to build.
 * @returns Absolute path of the unpacked build directory.
 */
function buildBrowserTarget(target) {
    const outputPath = resolveBuildPath(ROOT, target, BUILD_CHANNELS.RELEASE);
    const result = spawnSync('pnpm', ['exec', 'rspack', 'build', '--mode', 'production'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
            ...process.env,
            TARGET_BROWSER: target,
            BUILD_CHANNEL: BUILD_CHANNELS.RELEASE,
        },
    });
    if (result.status !== 0) {
        throw new Error(`rspack build failed for the ${target} target.`);
    }
    return outputPath;
}

/**
 * Requires one unpacked target to contain exactly the reviewed release
 * locales and generated compatibility aliases before any bytes enter a store
 * archive.
 *
 * @param target Browser target whose build is being verified.
 * @param outputDirectory Absolute path of the unpacked build directory.
 * @returns A promise that resolves after the locale inventory is verified.
 */
async function validatePackagedLocales(target, outputDirectory) {
    const localesDirectory = resolve(outputDirectory, '_locales');
    const packagedLocales = (await readdir(localesDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort();
    const aliases = target === 'chrome' ? CHROME_PACKAGED_LOCALE_ALIASES : {};
    const expectedLocales = target === 'chrome'
        ? [...CHROME_PACKAGED_LOCALES].sort()
        : [...SHIPPED_LOCALES].sort();
    if (JSON.stringify(packagedLocales) !== JSON.stringify(expectedLocales)) {
        throw new Error(
            `${target} package locales [${packagedLocales.join(', ')}] must match `
            + `the expected ${target} inventory [${expectedLocales.join(', ')}].`,
        );
    }
    for (const [alias, source] of Object.entries(aliases)) {
        const [aliasMessages, sourceMessages] = await Promise.all([
            readFile(resolve(localesDirectory, alias, 'messages.json')),
            readFile(resolve(localesDirectory, source, 'messages.json')),
        ]);
        if (!aliasMessages.equals(sourceMessages)) {
            throw new Error(`${target} package locale ${alias} must be byte-identical to ${source}.`);
        }
    }
}

await mkdir(RELEASE_DIR, { recursive: true });

for (const target of targets) {
    await rm(resolve(RELEASE_DIR, `${target}.zip`), { force: true });
    console.log(`\nBuilding the ${target} package…`);
    const outputDirectory = buildBrowserTarget(target);
    await validatePackagedLocales(target, outputDirectory);
    const entries = await collectDirectoryEntries(outputDirectory);
    await writeFile(resolve(RELEASE_DIR, `${target}.zip`), createDeterministicZip(entries, entryTimestamp));
    console.log(`  build/release/${target}.zip`);
}
console.log('\nRelease archives are in build/release.');

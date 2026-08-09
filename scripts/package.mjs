// Deterministic multi-browser packaging: builds every store target, zips
// each build byte-reproducibly, archives the tracked source for AMO review,
// and records SHA-256 checksums plus a provenance statement. The same commit
// always produces the same zips; see docs/release.md.

// fflate stores zip timestamps as local time, so the process timezone must
// be pinned before any timestamp conversion. Imports are safe to hoist above
// this line because none of them read the clock at load time.
process.env.TZ = 'UTC';

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
    CHROME_PACKAGED_LOCALE_ALIASES,
    CHROME_PACKAGED_LOCALES,
    SHIPPED_LOCALES,
} from '../src/shared/locales.ts';
import { BUILD_TARGETS } from './lib/browser-manifest.ts';
import {
    isWorktreeDirty,
    listTrackedFiles,
    readHeadCommit,
    readPackageVersion,
} from './lib/build-info.ts';
import { collectDirectoryEntries, createDeterministicZip } from './lib/deterministic-zip.ts';
import { buildProvenanceStatement, readGithubRunContext } from './lib/provenance.ts';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT, 'build/artifacts');
const CHECKSUMS_FILE = 'SHA256SUMS';
const PROVENANCE_FILE = 'provenance.json';

const knownArguments = ['--require-clean'];
const unknownArguments = process.argv.slice(2).filter((argument) => !knownArguments.includes(argument));
if (unknownArguments.length > 0) {
    throw new Error(`Unknown arguments: ${unknownArguments.join(' ')}. Supported: ${knownArguments.join(', ')}.`);
}
const requireClean = process.argv.includes('--require-clean');

if (isWorktreeDirty(ROOT)) {
    const message = 'Tracked files have uncommitted changes, so packages will not match the recorded commit.';
    if (requireClean) {
        throw new Error(message);
    }
    console.warn(`warning: ${message}`);
}

const version = readPackageVersion(ROOT);
const head = readHeadCommit(ROOT);
// Zip entry timestamps derive from the packaged commit, never from the
// clock, so rebuilding the same commit reproduces identical bytes.
const entryTimestamp = new Date(head.timestamp * 1000);

/**
 * Builds one browser target with rspack into build/<target>.
 *
 * @param target Browser target to build.
 * @returns Absolute path of the unpacked build directory.
 */
function buildBrowserTarget(target) {
    const outputPath = `build/${target}`;
    const result = spawnSync('pnpm', ['exec', 'rspack', 'build', '--mode', 'production'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
            ...process.env,
            TARGET_BROWSER: target,
            OUTPUT_PATH: outputPath,
        },
    });
    if (result.status !== 0) {
        throw new Error(`rspack build failed for the ${target} target.`);
    }
    return resolve(ROOT, outputPath);
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

await rm(ARTIFACTS_DIR, { force: true, recursive: true });
await mkdir(ARTIFACTS_DIR, { recursive: true });

const artifacts = [];
for (const target of BUILD_TARGETS) {
    console.log(`\nBuilding the ${target} package…`);
    const outputDirectory = buildBrowserTarget(target);
    await validatePackagedLocales(target, outputDirectory);
    const entries = await collectDirectoryEntries(outputDirectory);
    artifacts.push({
        name: `hn-split-${target}-${version}.zip`,
        data: createDeterministicZip(entries, entryTimestamp),
    });
}

console.log('\nArchiving the tracked source for store review…');
const sourceEntries = [];
for (const path of listTrackedFiles(ROOT)) {
    sourceEntries.push({
        path,
        data: new Uint8Array(await readFile(resolve(ROOT, path))),
    });
}
artifacts.push({
    name: `hn-split-source-${version}.zip`,
    data: createDeterministicZip(sourceEntries, entryTimestamp),
});

/**
 * Hashes one buffer with SHA-256.
 *
 * @param data Bytes to hash.
 * @returns Lowercase hex digest.
 */
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

const digests = artifacts
    .map(({ name, data }) => ({ name, sha256: sha256(data), bytes: data.byteLength }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
// sha256sum --check compatible: "<digest>  <name>" per line.
const checksums = `${digests.map((digest) => `${digest.sha256}  ${digest.name}`).join('\n')}\n`;

const provenance = buildProvenanceStatement({
    subjects: [
        ...digests.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
        { name: CHECKSUMS_FILE, sha256: sha256(checksums) },
    ],
    gitCommit: head.sha,
    startedOn: new Date(),
    github: readGithubRunContext(process.env),
});

for (const { name, data } of artifacts) {
    await writeFile(resolve(ARTIFACTS_DIR, name), data);
}
await writeFile(resolve(ARTIFACTS_DIR, CHECKSUMS_FILE), checksums);
await writeFile(resolve(ARTIFACTS_DIR, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`);

console.log(`\nPackaged version ${version} from commit ${head.sha}:`);
for (const digest of digests) {
    console.log(`  ${digest.name}  ${(digest.bytes / 1024).toFixed(1)} KiB  sha256:${digest.sha256.slice(0, 12)}…`);
}
console.log(`  ${CHECKSUMS_FILE}`);
console.log(`  ${PROVENANCE_FILE} (run metadata; not part of reproducibility comparisons)`);
console.log(`\nArtifacts are in build/artifacts. Verify with: shasum -a 256 -c ${CHECKSUMS_FILE}`);

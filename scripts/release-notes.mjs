// Prints one version's CHANGELOG.md section for use as the GitHub release
// body. --allow-missing downgrades a missing section to a placeholder so
// release dry runs can proceed before the changelog is finalized.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractReleaseNotes } from './lib/changelog.ts';

const args = process.argv.slice(2);
const allowMissing = args.includes('--allow-missing');
const positional = args.filter((argument) => argument !== '--allow-missing');
if (positional.length !== 1) {
    console.error('Usage: node scripts/release-notes.mjs <version> [--allow-missing]');
    process.exit(2);
}
// Accept both `0.1.0` and the tag form `v0.1.0`.
const version = positional[0].replace(/^v/, '');

const changelog = await readFile(resolve(import.meta.dirname, '../CHANGELOG.md'), 'utf8');
try {
    process.stdout.write(extractReleaseNotes(changelog, version));
} catch (error) {
    if (!allowMissing) {
        throw error;
    }
    console.error(`warning: ${error instanceof Error ? error.message : String(error)}`);
    process.stdout.write(`No changelog entry for ${version} yet.\n`);
}

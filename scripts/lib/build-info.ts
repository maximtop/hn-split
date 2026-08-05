import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXTENSION_VERSION_PATTERN } from './browser-manifest.ts';

/**
 * Identity of the commit a package set is built from.
 */
export interface HeadCommit {
    /**
     * Full commit hash.
     */
    sha: string;

    /**
     * Committer timestamp in whole seconds since the Unix epoch. Zip entry
     * timestamps derive from it so the same commit always packs to the same
     * bytes.
     */
    timestamp: number;
}

/**
 * Runs a git command in the repository and returns trimmed stdout.
 *
 * @param rootDirectory Repository root.
 * @param args Git arguments after the repository selector.
 * @returns Trimmed command output.
 */
function git(rootDirectory: string, args: string[]): string {
    return execFileSync('git', ['-C', rootDirectory, ...args], { encoding: 'utf8' }).trim();
}

/**
 * Reads the release version from package.json, the single source of truth
 * that packaging injects into every generated manifest.
 *
 * @param rootDirectory Repository root containing package.json.
 * @returns The validated version string.
 */
export function readPackageVersion(rootDirectory: string): string {
    const packageJson = JSON.parse(
        readFileSync(resolve(rootDirectory, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    const { version } = packageJson;
    if (typeof version !== 'string' || !EXTENSION_VERSION_PATTERN.test(version)) {
        throw new Error('package.json must declare a version of three dot-separated integers.');
    }
    return version;
}

/**
 * Reads the commit the working tree is checked out at.
 *
 * @param rootDirectory Repository root.
 * @returns Commit hash and committer timestamp.
 */
export function readHeadCommit(rootDirectory: string): HeadCommit {
    const sha = git(rootDirectory, ['rev-parse', 'HEAD']);
    const timestamp = Number(git(rootDirectory, ['log', '-1', '--format=%ct', 'HEAD']));
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
        throw new Error('Could not read the HEAD committer timestamp.');
    }
    return { sha, timestamp };
}

/**
 * Lists tracked files for the source archive, sorted byte-wise so archive
 * order never depends on git internals.
 *
 * @param rootDirectory Repository root.
 * @returns Repository-relative paths of every tracked file.
 */
export function listTrackedFiles(rootDirectory: string): string[] {
    return git(rootDirectory, ['ls-files', '-z'])
        .split('\0')
        .filter((path) => path !== '')
        .sort();
}

/**
 * Reports whether tracked files carry uncommitted changes. Untracked files
 * are ignored on purpose: build output and nested verification checkouts do
 * not affect packaged content, while a modified tracked file makes the
 * source archive disagree with the recorded commit.
 *
 * @param rootDirectory Repository root.
 * @returns True when a tracked file is modified.
 */
export function isWorktreeDirty(rootDirectory: string): boolean {
    return git(rootDirectory, ['status', '--porcelain', '--untracked-files=no']) !== '';
}

// @vitest-environment node
import { execFile } from 'node:child_process';
import {
    cp,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { resolveBuildPath } from '../scripts/lib/build-paths';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

/**
 * Runs a build-tooling subprocess with CI forced on, so pnpm's
 * dependency-drift self-check never blocks on an interactive TTY prompt
 * regardless of how this test itself was invoked.
 *
 * @param command - The executable to run.
 * @param args - The arguments passed to the executable.
 * @param options - The working directory and optional environment overrides.
 * @param options.cwd - The working directory the subprocess runs in.
 * @param options.env - Environment overrides applied on top of `CI=true`.
 */
async function run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<Awaited<ReturnType<typeof execFileAsync>>> {
    return execFileAsync(command, args, {
        ...options,
        env: { ...process.env, CI: 'true', ...options.env },
    });
}

it('rebuilds Chrome, preserves siblings and propagates command failures', async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), 'hn-split-build-'));
    try {
        for (const name of [
            'src', 'public', 'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
            'rspack.config.ts', 'Makefile',
        ]) {
            await cp(resolve(ROOT, name), resolve(workspace, name), { recursive: true });
        }
        // pnpm's dependency-drift check compares the lockfile and workspace
        // config against node_modules before running any command. Without a
        // matching lockfile and workspace config here, it decides the symlinked
        // node_modules is out of date and reinstalls into it — pruning packages
        // from the real repository's node_modules as a side effect, since the
        // symlink target is shared, not copied.
        await symlink(resolve(ROOT, 'node_modules'), resolve(workspace, 'node_modules'));
        const output = resolveBuildPath(workspace, 'chrome');
        await run('make', ['build'], { cwd: workspace });
        const manifestText = await readFile(resolve(output, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3;
        expect(manifest.manifest_version).toBe(3);
        expect(manifest.background?.service_worker).toBeDefined();
        await expect(stat(resolve(output, manifest.background!.service_worker))).resolves.toBeDefined();
        const version = JSON.parse(await readFile(resolve(workspace, 'package.json'), 'utf8')) as { version: string };
        expect(manifest.version).toBe(version.version);

        const siblings = ['edge', 'firefox', 'artifacts', 'ci-artifacts', 'release'];
        for (const sibling of siblings) {
            await mkdir(resolve(workspace, 'build', sibling), { recursive: true });
            await writeFile(resolve(workspace, 'build', sibling, 'keep.txt'), sibling);
        }
        await writeFile(resolve(output, 'stale.txt'), 'obsolete output');
        await rm(resolve(output, 'background.js'));
        await run('make', ['build'], { cwd: workspace });
        await expect(stat(resolve(output, 'background.js'))).resolves.toBeDefined();
        await expect(stat(resolve(output, 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(resolve(workspace, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' });
        for (const sibling of siblings) {
            expect(await readFile(resolve(workspace, 'build', sibling, 'keep.txt'), 'utf8')).toBe(sibling);
        }
        await expect(run('make', ['build', 'opera'], { cwd: workspace })).rejects.toMatchObject({ code: 2 });
        await expect(run('pnpm', ['build', '../escape'], { cwd: workspace })).rejects.toMatchObject({ code: 1 });
        await expect(run('pnpm', ['build', 'chrome', 'firefox'], { cwd: workspace })).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining('Choose at most one browser'),
        });

        const bin = resolve(workspace, 'bin');
        await mkdir(bin);
        await writeFile(resolve(bin, 'pnpm'), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
        await expect(run('make', ['build'], {
            cwd: workspace,
            env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
        })).rejects.toMatchObject({ code: 2 });
    } finally {
        await rm(workspace, { recursive: true, force: true });
    }
}, 60_000);

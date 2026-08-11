import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';

const SCRIPT_PATH = path.resolve('scripts/release/resolve-store-release.sh');

let temporaryPath: string;
let binaryPath: string;
let outputPath: string;
let commandLogPath: string;

const runResolver = (environment: NodeJS.ProcessEnv = {}) => {
    return spawnSync('bash', [SCRIPT_PATH], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binaryPath}:${process.env.PATH}`,
            RELEASE_TAG: 'v1.2.3',
            GITHUB_REPOSITORY: 'example/hn-split',
            GITHUB_OUTPUT: outputPath,
            COMMAND_LOG_PATH: commandLogPath,
            MOCK_RELEASE_JSON: '{"isDraft":false,"isPrerelease":false}',
            MOCK_GH_EXIT_CODE: '0',
            ...environment,
        },
    });
};

const readOutputs = (): string[] => {
    if (!fs.existsSync(outputPath)) {
        return [];
    }

    return fs.readFileSync(outputPath, 'utf8').trim().split('\n');
};

describe('store release resolver', () => {
    beforeEach(() => {
        temporaryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'store-release-test-'));
        binaryPath = path.join(temporaryPath, 'bin');
        outputPath = path.join(temporaryPath, 'github-output');
        commandLogPath = path.join(temporaryPath, 'commands.log');
        fs.mkdirSync(binaryPath);
        fs.writeFileSync(path.join(binaryPath, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMMAND_LOG_PATH"
if [[ "$MOCK_GH_EXIT_CODE" != 0 ]]; then
    exit "$MOCK_GH_EXIT_CODE"
fi
printf '%s\\n' "$MOCK_RELEASE_JSON"
`, { mode: 0o700 });
    });

    afterEach(() => {
        fs.rmSync(temporaryPath, { force: true, recursive: true });
    });

    it('resolves a published release tag and package version', () => {
        const result = runResolver();

        expect(result.status).toBe(0);
        expect(readOutputs()).toEqual([
            'tag=v1.2.3',
            'version=1.2.3',
            'asset=hn-split-chrome-1.2.3.zip',
        ]);
        expect(fs.readFileSync(commandLogPath, 'utf8')).toContain(
            'release view v1.2.3 --repo example/hn-split',
        );
    });

    it('rejects a tag outside the release version format', () => {
        const result = runResolver({ RELEASE_TAG: 'nightly' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Release tag must match vX.Y.Z');
        expect(readOutputs()).toEqual([]);
        expect(fs.existsSync(commandLogPath)).toBe(false);
    });

    it.each([
        ['draft', '{"isDraft":true,"isPrerelease":false}'],
        ['pre-release', '{"isDraft":false,"isPrerelease":true}'],
    ])('rejects a %s GitHub release', (kind, releaseJson) => {
        const result = runResolver({ MOCK_RELEASE_JSON: releaseJson });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`Release v1.2.3 is a ${kind}`);
        expect(readOutputs()).toEqual([]);
    });

    it('fails closed when the GitHub release lookup fails', () => {
        const result = runResolver({ MOCK_GH_EXIT_CODE: '23' });

        expect(result.status).toBe(23);
        expect(readOutputs()).toEqual([]);
    });
});

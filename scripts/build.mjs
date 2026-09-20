import { spawnSync } from 'node:child_process';

import { BUILD_CHANNELS } from './lib/build-paths.ts';
import { parseBuildTarget } from './lib/browser-manifest.ts';

const args = process.argv.slice(2);
const browsers = args.filter((argument) => argument !== '--watch');
if (browsers.length > 1) {
    throw new Error('Choose at most one browser: chrome, edge or firefox.');
}
const target = parseBuildTarget(browsers[0] ?? process.env.TARGET_BROWSER);
const result = spawnSync('pnpm', [
    'exec', 'rspack', 'build', '--mode', 'development',
    ...(args.includes('--watch') ? ['--watch'] : []),
], {
    stdio: 'inherit',
    env: { ...process.env, TARGET_BROWSER: target, BUILD_CHANNEL: BUILD_CHANNELS.DEV },
});
if (result.error) {
    throw result.error;
}
process.exitCode = result.status ?? 1;

/* global process, URL */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const basePath = '/casual-check/';
const apiPort = process.env.E2E_API_PORT || '8797';
const workers = process.platform === 'win32' ? 3 : 4;
const env = {
  ...process.env,
  E2E_WEB_PORT: process.env.E2E_WEB_PORT || '5187',
  E2E_API_PORT: apiPort,
  E2E_BASE_PATH: basePath,
  E2E_PREVIEW: '1',
  VITE_BASE_PATH: basePath,
  VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
};

function run(script, args, directory) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    cwd: fileURLToPath(new URL(directory, import.meta.url)),
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const buildStatus = run('../node_modules/vite/bin/vite.js', ['build'], '../apps/web/');
process.exitCode = buildStatus || run('../node_modules/@playwright/test/cli.js', ['test', `--workers=${workers}`, ...process.argv.slice(2)], '../');

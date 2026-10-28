/* global process, URL */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pagesConfig } from './release-config.mjs';

try {
  const config = pagesConfig(process.env);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build'], {
    cwd: fileURLToPath(new URL('../apps/web', import.meta.url)), stdio: 'inherit', windowsHide: true,
    env: { ...process.env, VITE_BASE_PATH: config.base, VITE_API_BASE_URL: config.api },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

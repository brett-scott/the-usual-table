/* global process, URL */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { workerConfig } from './release-config.mjs';

try {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--dry-run')) throw new Error('Only --dry-run is supported. Production settings come from the documented environment variables.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const base = JSON.parse(readFileSync(join(root, 'apps/server/wrangler.jsonc'), 'utf8'));
  const config = workerConfig(base, process.env);
  if (!flags.includes('--dry-run') && !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Set CLOUDFLARE_API_TOKEN to deploy; use --dry-run for local validation.');
  // Generated config has absolute entry/schema paths because it lives in an ignored directory.
  config.main = join(root, 'apps/server', base.main);
  config.$schema = join(root, 'node_modules/wrangler/config-schema.json');
  const directory = join(root, 'apps/server/.wrangler/release'); mkdirSync(directory, { recursive: true });
  const path = join(directory, 'wrangler.json'); writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', path, ...flags, '--outdir', join(root, 'apps/server/dist')], {
    cwd: join(root, 'apps/server'), stdio: 'inherit', windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

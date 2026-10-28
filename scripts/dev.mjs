/* global process, URL */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const webPort = process.env.WEB_PORT || '5173';
const apiPort = process.env.API_PORT || '8787';
const allowedOrigins = process.env.ALLOWED_ORIGINS || `http://127.0.0.1:${webPort},http://localhost:${webPort}`;
const children = [
  spawn(process.execPath, [`${root}/node_modules/wrangler/bin/wrangler.js`, 'dev', '--local', '--ip', '127.0.0.1', '--port', apiPort, '--var', `ALLOWED_ORIGINS:${allowedOrigins}`], { cwd: `${root}/apps/server`, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }),
  spawn(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, '--host', '127.0.0.1', '--port', webPort], { cwd: `${root}/apps/web`, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: { ...process.env, VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || `http://127.0.0.1:${apiPort}` } }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill();
  }
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.on('data', key => { if (key.includes(3)) stop(); }); }
for (const child of children) child.on('exit', code => { if (code && !stopping) { process.exitCode = code; stop(); } });

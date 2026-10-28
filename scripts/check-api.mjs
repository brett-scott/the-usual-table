/* global process, fetch, AbortSignal */
import { httpsOrigin, pagesConfig } from './release-config.mjs';

try {
  const { api } = pagesConfig(process.env);
  const origin = httpsOrigin(process.env.PAGES_ORIGIN || '', 'PAGES_ORIGIN');
  const health = await fetch(`${api}/api/v1/health`, { headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
  if (!health.ok || health.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error('The API health endpoint must allow PAGES_ORIGIN through CORS.');
  const body = await health.json();
  if (body.status !== 'ok' || body.protocol !== 1) throw new Error('The deployed API must support protocol 1.');
  const preflight = await fetch(`${api}/api/v1/rooms`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' }, signal: AbortSignal.timeout(15_000) });
  if (!preflight.ok || preflight.headers.get('Access-Control-Allow-Origin') !== origin || !preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase().includes('authorization')) throw new Error('The API must accept the frontend request preflight.');
  process.stdout.write('API health, protocol and frontend CORS preflight passed.\n');
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

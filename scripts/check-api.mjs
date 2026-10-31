/* global process, fetch, AbortSignal */
import { httpsOrigin, pagesConfig, publicAuthConfig } from './release-config.mjs';

try {
  const { api } = pagesConfig(process.env);
  const auth = publicAuthConfig(process.env);
  const origin = httpsOrigin(process.env.PAGES_ORIGIN || '', 'PAGES_ORIGIN');
  const health = await fetch(`${api}/api/v1/health`, { headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
  if (!health.ok || health.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error('The API health endpoint must allow PAGES_ORIGIN through CORS.');
  const body = await health.json();
  if (body.status !== 'ok' || body.protocol !== 1) throw new Error('The deployed API must support protocol 1.');
  if (body.authProjectUrl !== auth.url) throw new Error('Deploy the updated Worker with the same Supabase project as the frontend before publishing Pages.');
  const session = await fetch(`${api}/api/v1/account/session`, { headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
  const sessionBody = await session.json();
  if (session.status !== 401 || sessionBody.code !== 'ACCOUNT_SESSION_INVALID' || session.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error('The deployed Worker must expose account verification and reject unauthenticated account requests.');
  for (const method of ['GET', 'POST']) {
    const wallet = await fetch(`${api}/api/v1/account/wallet`, { method, headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
    const value = await wallet.json();
    if (wallet.status !== 401 || value.code !== 'ACCOUNT_SESSION_INVALID' || wallet.headers.get('Access-Control-Allow-Origin') !== origin)
      throw new Error('Deploy the updated Worker wallet read/provisioning routes before publishing Pages.');
  }
  const preflight = await fetch(`${api}/api/v1/rooms`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' }, signal: AbortSignal.timeout(15_000) });
  if (!preflight.ok || preflight.headers.get('Access-Control-Allow-Origin') !== origin || !preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase().includes('authorization')) throw new Error('The API must accept the frontend request preflight.');
  process.stdout.write('API health, protocol, matching Auth project, account rejection and frontend CORS preflight passed.\n');
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

/* global process, URL */
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const fixture = `
const origin = 'https://player.example.test';
const project = 'https://npqvazffslqmfjtyyhpn.supabase.co';
globalThis.fetch = async (input, options) => {
  const path = new URL(input).pathname;
  if (path === '/api/v1/health') return Response.json({status:'ok',protocol:1,
    ...(process.env.CHECK_SCENARIO === 'old-worker' ? {} : {authProjectUrl:process.env.CHECK_SCENARIO === 'wrong-project' ? 'https://wrong.supabase.co' : project})},
    {headers:{'Access-Control-Allow-Origin':origin}});
  if (path === '/api/v1/account/session') return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO === 'account-accepted' ? 200 : process.env.CHECK_SCENARIO === 'account-missing' ? 404 : 401,
    headers:{'Access-Control-Allow-Origin':process.env.CHECK_SCENARIO === 'account-cors' ? 'https://wrong.test' : origin}});
  if (path === '/api/v1/account/wallet') return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO === 'wallet-read-missing' && options.method === 'GET' || process.env.CHECK_SCENARIO === 'wallet-create-missing' && options.method === 'POST' ? 404 : 401,
      headers:{'Access-Control-Allow-Origin':origin}});
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,authorization'}});
};
await import(${JSON.stringify(new URL('./check-api.mjs', import.meta.url).href)});
`;
function check(scenario) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', fixture], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CHECK_SCENARIO: scenario, VITE_BASE_PATH: '/the-usual-table/', VITE_API_BASE_URL: 'https://api.example.test',
      PAGES_ORIGIN: 'https://player.example.test', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' } });
}
it('accepts a matching Auth project, account rejection and CORS before Pages publishing', () => {
  const result = check('success'); expect(result.status).toBe(0); expect(result.stdout).toContain('account rejection');
});
it.each(['old-worker', 'wrong-project'])('rejects an %s deployment before Pages publishing', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('Deploy the updated Worker');
});
it.each(['account-accepted', 'account-missing', 'account-cors'])('rejects an invalid account gate: %s', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('account verification');
});
it.each(['wallet-read-missing', 'wallet-create-missing'])('rejects a Worker missing a wallet route: %s', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('wallet read/provisioning');
});

/* global process, URL */
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const fixture = `
const origin = 'https://player.example.test';
const project = 'https://npqvazffslqmfjtyyhpn.supabase.co';
globalThis.fetch = async (input, options) => {
  const path = new URL(input).pathname;
  if (path === '/api/v1/health') return Response.json({status:'ok',protocol:1,...(process.env.CHECK_SCENARIO==='missing-keno'?{}:{kenoProtocol:process.env.CHECK_SCENARIO==='legacy-keno'?1:2}),
    ...(process.env.CHECK_SCENARIO==='missing-roulette'?{}:{rouletteProtocol:1}),...(process.env.CHECK_SCENARIO==='missing-duck-race'?{}:{duckRaceProtocol:1}),...(process.env.CHECK_SCENARIO==='missing-baccarat'?{}:{baccaratProtocol:process.env.CHECK_SCENARIO==='old-baccarat'?2:3}),...(process.env.CHECK_SCENARIO==='missing-crash'?{}:{crashProtocol:process.env.CHECK_SCENARIO==='old-crash'?1:2}),
    ...(process.env.CHECK_SCENARIO==='missing-game-adapters'?{}:{gameAdapterProtocol:1}),
    ...(process.env.CHECK_SCENARIO === 'missing-collections-protocol' ? {} : {accountCollectionsProtocol:1}),
    ...(process.env.CHECK_SCENARIO === 'missing-rewards-protocol' ? {} : {accountRewardsProtocol:1}),
    ...(process.env.CHECK_SCENARIO === 'missing-account-play' ? {} : {accountPlayProtocol:1}),
    ...(process.env.CHECK_SCENARIO === 'missing-statistics-protocol' ? {} : {accountStatisticsProtocol:1}),
    ...(process.env.CHECK_SCENARIO === 'old-worker' ? {} : {authProjectUrl:process.env.CHECK_SCENARIO === 'wrong-project' ? 'https://wrong.supabase.co' : project})},
    {headers:{'Access-Control-Allow-Origin':origin}});
  if(path==='/api/v1/account/collection') return Response.json({code:'ACCOUNT_SESSION_INVALID'},{status:process.env.CHECK_SCENARIO==='collections-missing'?404:401,headers:{'Access-Control-Allow-Origin':origin}});
  if (path === '/api/v1/account/session') return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO === 'account-accepted' ? 200 : process.env.CHECK_SCENARIO === 'account-missing' ? 404 : 401,
    headers:{'Access-Control-Allow-Origin':process.env.CHECK_SCENARIO === 'account-cors' ? 'https://wrong.test' : origin}});
  if(['/api/v1/account/allowance','/api/v1/account/progression','/api/v1/account/statistics/details'].includes(path)) return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO==='rewards-missing'?404:401,headers:{'Access-Control-Allow-Origin':origin}});
  if (path === '/api/v1/account/wallet') return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO === 'wallet-read-missing' && options.method === 'GET' || process.env.CHECK_SCENARIO === 'wallet-create-missing' && options.method === 'POST' ? 404 : 401,
      headers:{'Access-Control-Allow-Origin':origin}});
  if (path === '/api/v1/account/statistics') return Response.json({code:'ACCOUNT_SESSION_INVALID'},
    {status:process.env.CHECK_SCENARIO === 'statistics-missing' ? 404 : process.env.CHECK_SCENARIO === 'statistics-accepted' ? 200 : 401,
      headers:{'Access-Control-Allow-Origin':process.env.CHECK_SCENARIO === 'statistics-cors' ? 'https://wrong.test' : origin}});
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
it('requires the updated account-play Worker before publishing the saved-chip entry flow', () => {
  const result = check('missing-account-play'); expect(result.status).toBe(1); expect(result.stderr).toContain('saved-chip Blackjack');
});
it.each(['account-accepted', 'account-missing', 'account-cors'])('rejects an invalid account gate: %s', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('account verification');
});
it.each(['wallet-read-missing', 'wallet-create-missing'])('rejects a Worker missing a wallet route: %s', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('wallet read/provisioning');
});
it.each(['missing-statistics-protocol', 'statistics-missing', 'statistics-accepted', 'statistics-cors'])('requires the private statistics endpoint before Pages: %s', scenario => {
  const result = check(scenario); expect(result.status).toBe(1); expect(result.stderr).toContain('account statistics');
});
it.each(['missing-rewards-protocol','rewards-missing'])('requires the rewards Worker before Pages: %s',scenario=>{const result=check(scenario);expect(result.status).toBe(1);expect(result.stderr).toContain('account rewards');});
it('requires the shared game adapter Worker before publishing the new table flow',()=>{const result=check('missing-game-adapters');expect(result.status).toBe(1);expect(result.stderr).toContain('shared game adapters');});
it('requires the Crash Worker before publishing its game entry',()=>{const result=check('missing-crash');expect(result.status).toBe(1);expect(result.stderr).toContain('Crash');});
it('refuses a Crash Worker that cannot publish confirmed progress',()=>{const result=check('old-crash');expect(result.status).toBe(1);expect(result.stderr).toContain('server-confirmed Crash progress');});

it('requires the Baccarat Worker before publishing its game entry',()=>{const result=check('missing-baccarat');expect(result.status).toBe(1);expect(result.stderr).toContain('Baccarat');});

it('requires the Baccarat side-bet Worker before publishing expanded betting',()=>{const result=check('old-baccarat');expect(result.status).toBe(1);expect(result.stderr).toContain('Baccarat side-bet');});

it('requires the Duck Race Worker before publishing its entry',()=>{const result=check('missing-duck-race');expect(result.status).toBe(1);expect(result.stderr).toContain('Duck Race');});

it('requires the Roulette Worker before Pages',()=>{const result=check('missing-roulette');expect(result.status).toBe(1);expect(result.stderr).toContain('Roulette');});

it.each(['missing-collections-protocol','collections-missing'])('requires private collection support before Pages: %s',scenario=>{const result=check(scenario);expect(result.status).toBe(1);expect(result.stderr).toContain('account collections');});

it('requires the Keno Worker before Pages',()=>{const result=check('missing-keno');expect(result.status).toBe(1);expect(result.stderr).toContain('Keno');});

it('requires the updated Keno rules before Pages',()=>{const result=check('legacy-keno');expect(result.status).toBe(1);expect(result.stderr).toContain('one-second');});

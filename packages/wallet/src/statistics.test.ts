import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { accountStatisticsSchema, type WalletSession } from '@casual/protocol';
import { PostgresWalletStore } from './index';
import { supabaseAuthFixture } from './supabaseFixture';

let db: PGlite; let store: PostgresWalletStore; let setup: string;
beforeAll(async () => {
  db = await PGlite.create(); await db.exec(supabaseAuthFixture);
  setup = await readFile(new URL('../../../supabase/wallet-setup.sql', import.meta.url), 'utf8'); await db.exec(setup);
  store = new PostgresWalletStore(db);
}, 30000);
afterAll(async () => { await db?.close(); });
async function account(provider = 'google') {
  const id = crypto.randomUUID(); await db.query('INSERT INTO auth.users (id,raw_app_meta_data) VALUES($1,$2)', [id, JSON.stringify({ provider })]);
  await rpc(id, 'usual_table_ensure_wallet'); return id;
}
async function rpc(id: string | null, name = 'usual_table_account_statistics', role = 'authenticated', extra = {}) {
  return db.transaction(async tx => {
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, role, is_anonymous: false, amr: [{ method: 'oauth' }], ...extra })]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return (await tx.query<{ value: unknown }>(`SELECT public.${name}() AS value`)).rows[0]!.value;
  });
}
async function playing(id: string, gameId: WalletSession['gameId'] = 'blackjack') {
  const session = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'allocate', sessionId: crypto.randomUUID(), roomId: crypto.randomUUID(), gameId, funding: 'account', amountUnits: 100000 })).session!;
  return (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'activate', sessionId: session.sessionId, expectedVersion: session.version })).session!;
}
function result(session: WalletSession, returnedUnits: number) {
  return { contract: 1 as const, accountId: session.accountId, operationId: crypto.randomUUID(), kind: 'settle' as const,
    sessionId: session.sessionId, expectedVersion: session.version, roomId: session.roomId, gameId: session.gameId, funding: 'account' as const,
    sequence: session.resultSequence + 1, roundId: String(session.resultSequence + 1), rulesetVersion: 'blackjack-v1', wageredUnits: 1000, returnedUnits };
}
it('reads only verified settled rounds, groups games and counts replayed results once', async () => {
  const id = await account(); let session = await playing(id);
  expect(accountStatisticsSchema.parse(await rpc(id)).games).toEqual([]);
  for (const returned of [2000, 0, 1000]) {
    const command = result(session, returned);
    const receipt = await store.execute(command); expect(await store.execute(command)).toEqual(receipt); session = receipt.session!;
  }
  const roulette = await playing(id, 'keno'); await store.execute(result(roulette, 1500));
  const stats = accountStatisticsSchema.parse(await rpc(id));
  expect(stats.games.find(game => game.gameId === 'blackjack')).toEqual({ gameId: 'blackjack', roundsPlayed: '3', roundsWon: '1', roundsLost: '1', roundsEven: '1', wageredUnits: '3000', returnedUnits: '3000', netUnits: '0', bestRoundNetUnits: '1000' });
  expect(stats.games.find(game => game.gameId === 'keno')).toMatchObject({ roundsPlayed: '1', netUnits: '500' });
  const other = await account('discord'); expect(accountStatisticsSchema.parse(await rpc(other))).toMatchObject({ accountId: other, games: [] });
  const returning = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'request_return', sessionId: session.sessionId, expectedVersion: session.version, finalSequence: 3, finalStackUnits: session.stackUnits })).session!;
  await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'complete_return', sessionId: returning.sessionId, expectedVersion: returning.version });
  expect(await rpc(id)).toEqual(stats);
});
it('includes historical results on installation/rerun without rewriting balances or history', async () => {
  const id = await account(); const session = await playing(id); await store.execute(result(session, 2500));
  const before = await rpc(id); const wallet = await store.getWallet(id);
  await db.exec('DROP FUNCTION public.usual_table_account_statistics();');
  await db.exec(setup);
  expect(await rpc(id)).toEqual(before); expect(await store.getWallet(id)).toEqual(wallet);
  await db.exec(setup); expect(await rpc(id)).toEqual(before);
});
it('does not count grants, allocations, rejected or rolled-back results', async () => {
  const id = await account(); const session = await playing(id);
  await expect(store.execute({ ...result(session, 2000), sequence: 5 })).rejects.toMatchObject({ code: 'RESULT_ORDER' });
  expect(accountStatisticsSchema.parse(await rpc(id)).games).toEqual([]);
  const command = result(session, 2000); const wallet = await store.getWallet(id);
  await db.exec(`CREATE FUNCTION wallet_private.fail_statistics_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated ledger failure'; END; $$;
    CREATE TRIGGER fail_statistics_test BEFORE INSERT ON wallet_private.ledger FOR EACH ROW WHEN (NEW.account_id = '${id}'::uuid) EXECUTE FUNCTION wallet_private.fail_statistics_test();`);
  try {
    await expect(store.execute(command)).rejects.toThrow('Simulated ledger failure');
    expect(accountStatisticsSchema.parse(await rpc(id)).games).toEqual([]); expect(await store.getWallet(id)).toEqual(wallet);
  } finally { await db.exec('DROP TRIGGER fail_statistics_test ON wallet_private.ledger; DROP FUNCTION wallet_private.fail_statistics_test();'); }
  await store.execute(command); expect(accountStatisticsSchema.parse(await rpc(id)).games[0]?.roundsPlayed).toBe('1');
});
it('rejects anonymous, deleted, wrong-provider and non-OAuth callers and exposes no private tables', async () => {
  const id = await account(); const email = crypto.randomUUID();
  await db.query('INSERT INTO auth.users (id,raw_app_meta_data) VALUES($1,$2)', [email, JSON.stringify({ provider: 'email' })]);
  await expect(rpc(email)).rejects.toThrow('current social account');
  await expect(rpc(id, 'usual_table_account_statistics', 'anon')).rejects.toThrow();
  await expect(rpc(null)).rejects.toThrow();
  await expect(rpc(id, 'usual_table_account_statistics', 'authenticated', { amr: [{ method: 'password' }] })).rejects.toThrow();
  await db.query('DELETE FROM auth.users WHERE id=$1', [id]); await expect(rpc(id)).rejects.toThrow();
  await expect(db.transaction(async tx => { await tx.exec('SET LOCAL ROLE authenticated'); await tx.query('SELECT * FROM wallet_private.results'); })).rejects.toThrow();
});

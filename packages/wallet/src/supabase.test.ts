import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { walletReceiptSchema, walletSummarySchema } from '@casual/protocol';
import { PostgresWalletStore } from './index';
import { supabaseAuthFixture } from './supabaseFixture';

let db: PGlite; let store: PostgresWalletStore; let setup: string;
beforeAll(async () => {
  db = await PGlite.create(); await db.exec(supabaseAuthFixture);
  setup = await readFile(new URL('../../../supabase/wallet-setup.sql', import.meta.url), 'utf8'); await db.exec(setup);
  store = new PostgresWalletStore(db, { welcome: { version: 'test-only', amountUnits: 100000 } });
}, 30000);
afterAll(async () => { await db?.close(); });
async function social(provider = 'google') {
  const id = crypto.randomUUID(); await db.query('INSERT INTO auth.users (id, raw_app_meta_data) VALUES ($1, $2)', [id, JSON.stringify({ provider })]); return id;
}
async function rpc(id: string | null, name = 'usual_table_wallet_summary', overrides = {}, role = 'authenticated') {
  return db.transaction(async tx => {
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role, is_anonymous: false, amr: [{ method: 'oauth' }], ...overrides })]);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return (await tx.query<{ wallet: unknown }>(`SELECT public.${name}() AS wallet`)).rows[0]!.wallet;
  });
}
it('awards exactly 10,000 chips once with a valid receipt and preserves depleted funds on repeated setup', async () => {
  const id = await social(); expect(await rpc(id)).toBeNull();
  expect(walletSummarySchema.parse(await rpc(id, 'usual_table_ensure_wallet'))).toMatchObject({ accountId: id, availableUnits: 1000000, version: 1 });
  const operation = (await db.query<{ request: { operationId: string }; receipt: unknown }>('SELECT request, receipt FROM wallet_private.operations WHERE account_id=$1', [id])).rows[0]!;
  expect(walletReceiptSchema.parse(operation.receipt).wallet.availableUnits).toBe(1000000);
  expect(await store.execute({ contract: 1, accountId: id, operationId: operation.request.operationId, kind: 'claim_grant', source: 'welcome' })).toEqual(operation.receipt);
  await expect(store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'claim_grant', source: 'welcome' })).rejects.toMatchObject({ code: 'GRANT_ALREADY_CLAIMED' });
  const pending = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'allocate', sessionId: crypto.randomUUID(), roomId: 'deplete', gameId: 'blackjack', funding: 'account', amountUnits: 1000000 })).session!;
  const active = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'activate', sessionId: pending.sessionId, expectedVersion: pending.version })).session!;
  await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'settle', sessionId: active.sessionId, expectedVersion: active.version, gameId: 'blackjack', roomId: 'deplete', funding: 'account', sequence: 1, roundId: '1', rulesetVersion: 'test-v1', wageredUnits: 1000000, returnedUnits: 0 });
  expect(await rpc(id, 'usual_table_ensure_wallet')).toEqual(await store.getWallet(id));
  expect((await store.getWallet(id)).availableUnits).toBe(0);
  expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_private.ledger WHERE account_id=$1 AND kind='claim_grant'", [id])).rows[0]!.n).toBe(1);
});
it('keeps accounts isolated and reports available, allocated and returning amounts from durable storage', async () => {
  const id = await social(); const other = await social('discord'); await rpc(id, 'usual_table_ensure_wallet'); await rpc(other, 'usual_table_ensure_wallet');
  const pending = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'allocate', sessionId: crypto.randomUUID(), roomId: 'room-a', gameId: 'blackjack', funding: 'account', amountUnits: 25000 })).session!;
  expect(await rpc(id)).toEqual(await store.getWallet(id));
  const active = (await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'activate', sessionId: pending.sessionId, expectedVersion: pending.version })).session!;
  await store.execute({ contract: 1, accountId: id, operationId: crypto.randomUUID(), kind: 'request_return', sessionId: active.sessionId, expectedVersion: active.version, finalSequence: 0, finalStackUnits: 25000 });
  expect(await rpc(id)).toEqual(await store.getWallet(id));
  expect(await rpc(other)).toMatchObject({ accountId: other, availableUnits: 1000000, atTablesUnits: 0, pendingReturnUnits: 0 });
});
it('denies anonymous, missing, deleted and unsupported-provider users and non-OAuth claims', async () => {
  const id = await social(); const email = await social('email'); const missing = crypto.randomUUID();
  for (const [subject, claims] of [[null, {}], [missing, {}], [email, {}], [id, { is_anonymous: true }], [id, { amr: [] }], [id, { amr: [{ method: 'password' }] }], [id, { amr: [{ method: 'oauth' }, { method: 'otp' }] }]] as const)
    await expect(rpc(subject, 'usual_table_ensure_wallet', claims)).rejects.toThrow();
  await expect(rpc(id, 'usual_table_ensure_wallet', {}, 'anon')).rejects.toThrow();
  await rpc(id, 'usual_table_ensure_wallet'); await db.query('DELETE FROM auth.users WHERE id=$1', [id]);
  await expect(rpc(id)).rejects.toThrow(); await expect(rpc(id, 'usual_table_ensure_wallet')).rejects.toThrow();
});
it('does not let authenticated users read/write private tables, choose another ID or provide a balance', async () => {
  const id = await social(); await rpc(id, 'usual_table_ensure_wallet');
  for (const sql of ["SELECT * FROM wallet_private.wallets", "UPDATE wallet_private.wallets SET available_units=999999", "INSERT INTO wallet_private.accounts VALUES (gen_random_uuid(), 'active', now())", "SELECT public.usual_table_ensure_wallet('00000000-0000-4000-8000-000000000000')", "SELECT wallet_private.social_account_id()"])
    await expect(db.transaction(async tx => { await tx.exec('SET LOCAL ROLE authenticated'); await tx.exec(sql); })).rejects.toThrow();
  expect((await store.getWallet(id)).availableUnits).toBe(1000000);
});
it('preserves suspended accounts, balances, tables and history when the installer is run again', async () => {
  const id = await social(); await rpc(id, 'usual_table_ensure_wallet'); await store.setAccountStatus(id, 'suspended');
  const before = await store.getWallet(id); await db.exec(setup);
  expect(await rpc(id, 'usual_table_ensure_wallet')).toEqual(before);
  expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM wallet_private.schema_version')).rows[0]!.n).toBe(1);
});
it('does not repair a broken existing wallet by resetting it', async () => {
  const id = await social(); await db.query('INSERT INTO wallet_private.accounts(account_id) VALUES($1)', [id]);
  await expect(rpc(id, 'usual_table_ensure_wallet')).rejects.toThrow('incomplete');
  expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM wallet_private.wallets WHERE account_id=$1', [id])).rows[0]!.n).toBe(0);
});
it('does not retroactively top up existing zero or previously funded wallets', async () => {
  const zero = await social(); const funded = await social(); await store.createAccount(zero); await store.createAccount(funded);
  await store.execute({ contract: 1, accountId: funded, operationId: crypto.randomUUID(), kind: 'claim_grant', source: 'welcome' });
  await db.exec(setup);
  expect(await rpc(zero, 'usual_table_ensure_wallet')).toMatchObject({ availableUnits: 0, version: 0 });
  expect(await rpc(funded, 'usual_table_ensure_wallet')).toMatchObject({ availableUnits: 100000, version: 1 });
});
it('rolls back the entire first grant if recording history fails, then grants once on retry', async () => {
  const id = await social();
  await db.exec(`CREATE FUNCTION wallet_private.fail_test_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated grant history failure'; END; $$;
    CREATE TRIGGER fail_test_grant BEFORE INSERT ON wallet_private.ledger FOR EACH ROW WHEN (NEW.account_id = '${id}'::uuid) EXECUTE FUNCTION wallet_private.fail_test_grant();`);
  try {
    await expect(rpc(id, 'usual_table_ensure_wallet')).rejects.toThrow('Simulated grant history failure');
    for (const table of ['accounts', 'wallets', 'grant_claims', 'ledger', 'operations'])
      expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM wallet_private.${table} WHERE account_id=$1`, [id])).rows[0]!.n).toBe(0);
  } finally { await db.exec('DROP TRIGGER fail_test_grant ON wallet_private.ledger; DROP FUNCTION wallet_private.fail_test_grant();'); }
  expect(await rpc(id, 'usual_table_ensure_wallet')).toMatchObject({ availableUnits: 1000000, version: 1 });
  expect(await rpc(id, 'usual_table_ensure_wallet')).toMatchObject({ availableUnits: 1000000, version: 1 });
});

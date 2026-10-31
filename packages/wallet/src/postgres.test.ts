import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { WalletCommand } from '@casual/protocol';
import { PostgresWalletStore } from './index';
import { postgresPoolCloser, postgresWalletDatabase } from './postgres';
import { supabaseAuthFixture } from './supabaseFixture';

let server: EmbeddedPostgres; let pool: pg.Pool; let store: PostgresWalletStore;
let directory = ''; let started = false;
let backendConnection = '';
let closePool: (() => Promise<void>) | undefined;
const parent = resolve('.wrangler');
beforeAll(async () => {
  await mkdir(parent, { recursive: true }); directory = await mkdtemp(join(parent, 'wallet-pg-'));
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No local test port');
  const port = address.port; await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const password = crypto.randomUUID();
  server = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), port, user: 'wallet_test', password,
    persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true,
    postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'max_connections=20'],
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start(); started = true;
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'wallet_test', password, database: 'postgres', max: 8,
    connectionTimeoutMillis: 5000, statement_timeout: 10_000 });
  closePool = postgresPoolCloser(pool);
  await pool.query(await readFile(new URL('../migrations/001_wallet.sql', import.meta.url), 'utf8'));
  await pool.query(supabaseAuthFixture);
  await pool.query(await readFile(new URL('../migrations/002_supabase_wallet_api.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/003_welcome_grant.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/004_backend_role.sql', import.meta.url), 'utf8'));
  const backendPassword = crypto.randomUUID();
  await pool.query(`CREATE ROLE wallet_backend_test LOGIN PASSWORD '${backendPassword}' IN ROLE usual_table_wallet_backend`);
  backendConnection = `postgresql://wallet_backend_test:${backendPassword}@127.0.0.1:${port}/postgres`;
  store = new PostgresWalletStore(postgresWalletDatabase(pool), { welcome: { version: 'test-only', amountUnits: 100_000 } });
}, 60_000);
afterAll(async () => {
  try { await closePool?.(); }
  finally {
    if (started) await server.stop();
    // Only this suite's freshly created directory may be recursively removed.
    if (directory && dirname(resolve(directory)) === parent && basename(directory).startsWith('wallet-pg-')) await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
async function account() {
  const accountId = crypto.randomUUID(); await store.createAccount(accountId);
  await store.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'claim_grant', source: 'welcome' });
  return accountId;
}
function allocate(accountId: string, gameId: 'blackjack' | 'baccarat' = 'blackjack', amountUnits = 20_000): Extract<WalletCommand, { kind: 'allocate' }> {
  return { contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'allocate', sessionId: crypto.randomUUID(),
    roomId: crypto.randomUUID(), gameId, funding: 'account', amountUnits };
}
it('uses independent PostgreSQL backends and locks a wallet against concurrent cross-game spending', async () => {
  const accountId = await account();
  const first = await pool.connect(); const second = await pool.connect();
  try {
    const ids = await Promise.all([first.query('SELECT pg_backend_pid() AS pid'), second.query('SELECT pg_backend_pid() AS pid')]);
    expect(ids[0]!.rows[0].pid).not.toBe(ids[1]!.rows[0].pid);
    await first.query('BEGIN'); await first.query('SELECT account_id FROM wallet_private.accounts WHERE account_id = $1 FOR UPDATE', [accountId]);
    const attempts = [store.execute(allocate(accountId, 'blackjack', 75_000)), store.execute(allocate(accountId, 'baccarat', 75_000))];
    // Both independent transactions must be blocked on the held account lock before it is released.
    try {
      await expect.poll(async () => Number((await second.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF a, w%'`)).rows[0].n)).toBe(2);
    } finally { await first.query('COMMIT'); }
    const results = await Promise.allSettled(attempts);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'INSUFFICIENT_FUNDS' } });
    expect(await store.getWallet(accountId)).toMatchObject({ availableUnits: 25_000, atTablesUnits: 75_000 });
  } finally { first.release(); second.release(); }
});
it('commits one receipt for concurrent retries over pooled connections', async () => {
  const accountId = await account(); const input = allocate(accountId);
  const results = await Promise.all(Array.from({ length: 6 }, () => store.execute(input)));
  expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
  expect((await pool.query('SELECT count(*)::int AS n FROM wallet_private.ledger WHERE account_id = $1 AND kind = $2', [accountId, 'allocate'])).rows[0].n).toBe(1);
});
it('rolls back a real transaction and releases its connection for the next operation', async () => {
  const accountId = await account(); const database = postgresWalletDatabase(pool);
  await expect(database.transaction(async tx => {
    await tx.query('UPDATE wallet_private.wallets SET available_units = 1 WHERE account_id = $1', [accountId]);
    throw new Error('simulated transaction abort');
  })).rejects.toThrow('simulated transaction abort');
  expect((await store.getWallet(accountId)).availableUnits).toBe(100_000);
  expect((await store.execute(allocate(accountId))).wallet.availableUnits).toBe(80_000);
});
it('credits a pending return once when independent connections retry its completion', async () => {
  const accountId = await account(); const pending = (await store.execute(allocate(accountId))).session!;
  const base = { contract: 1 as const, accountId, sessionId: pending.sessionId };
  const active = (await store.execute({ ...base, operationId: crypto.randomUUID(), kind: 'activate', expectedVersion: pending.version })).session!;
  const sealed = (await store.execute({ ...base, operationId: crypto.randomUUID(), kind: 'request_return', expectedVersion: active.version,
    finalSequence: 0, finalStackUnits: active.stackUnits })).session!;
  const input: WalletCommand = { ...base, operationId: crypto.randomUUID(), kind: 'complete_return', expectedVersion: sealed.version };
  await Promise.all(Array.from({ length: 6 }, () => store.execute(input)));
  expect(await store.getWallet(accountId)).toMatchObject({ availableUnits: 100_000, atTablesUnits: 0, pendingReturnUnits: 0 });
  expect((await pool.query('SELECT count(*)::int AS n FROM wallet_private.ledger WHERE account_id = $1 AND kind = $2', [accountId, 'complete_return'])).rows[0].n).toBe(1);
});
it('awards one 10,000-chip welcome grant across concurrent requests without resetting spent funds', async () => {
  const accountId = crypto.randomUUID(); await pool.query('INSERT INTO auth.users(id) VALUES($1)', [accountId]);
  async function provision() {
    return postgresWalletDatabase(pool).transaction(async tx => {
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: accountId, role: 'authenticated', amr: [{ method: 'oauth' }] })]);
      await tx.query('SET LOCAL ROLE authenticated');
      return (await tx.query<{ wallet: { availableUnits: number } }>('SELECT public.usual_table_ensure_wallet() AS wallet')).rows[0]!.wallet;
    });
  }
  const first = await Promise.all(Array.from({ length: 6 }, provision)); expect(first.every(result => result.availableUnits === 1000000)).toBe(true);
  await store.execute(allocate(accountId, 'blackjack', 25000));
  const retry = await Promise.all(Array.from({ length: 6 }, provision)); expect(retry.every(result => result.availableUnits === 975000)).toBe(true);
  expect((await pool.query('SELECT count(*)::int AS n FROM wallet_private.wallets WHERE account_id=$1', [accountId])).rows[0].n).toBe(1);
  expect((await pool.query("SELECT count(*)::int AS n FROM wallet_private.ledger WHERE account_id=$1 AND kind='claim_grant'", [accountId])).rows[0].n).toBe(1);
  expect((await pool.query("SELECT count(*)::int AS n FROM wallet_private.grant_claims WHERE account_id=$1 AND source='welcome'", [accountId])).rows[0].n).toBe(1);
  const totals = (await pool.query('SELECT sum(available_delta)::bigint AS available, sum(table_delta)::bigint AS tables FROM wallet_private.ledger WHERE account_id=$1', [accountId])).rows[0];
  expect(Number(totals.available)).toBe(975000); expect(Number(totals.tables)).toBe(25000);
});
it('executes real funding/results/returns through the restricted Hyperdrive role and rejects history edits', async () => {
  const accountId = await account();
  const base = postgresWalletDatabase(pool);
  const restricted = new PostgresWalletStore({ query: (sql, params) => base.transaction(async tx => {
    await tx.query('SET LOCAL ROLE usual_table_wallet_backend'); return tx.query(sql, params);
  }), transaction: work => base.transaction(async tx => { await tx.query('SET LOCAL ROLE usual_table_wallet_backend'); return work(tx); }) });
  const allocated = (await restricted.execute(allocate(accountId, 'blackjack', 20000))).session!;
  const active = (await restricted.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'activate', sessionId: allocated.sessionId, expectedVersion: allocated.version })).session!;
  const settled = (await restricted.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'settle', sessionId: active.sessionId, expectedVersion: active.version,
    funding: 'account', gameId: 'blackjack', roomId: active.roomId, sequence: 1, roundId: '1', rulesetVersion: 'test-v1', wageredUnits: 1000, returnedUnits: 2000 })).session!;
  const returning = (await restricted.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'request_return', sessionId: settled.sessionId,
    expectedVersion: settled.version, finalSequence: 1, finalStackUnits: 21000 })).session!;
  const done = await restricted.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'complete_return', sessionId: returning.sessionId, expectedVersion: returning.version });
  expect(done.wallet).toMatchObject({ availableUnits: 101000, atTablesUnits: 0, pendingReturnUnits: 0 });
  for (const sql of ['DELETE FROM wallet_private.ledger', 'UPDATE wallet_private.operations SET receipt=receipt', 'SELECT * FROM auth.users'])
    await expect(base.transaction(async tx => { await tx.query('SET LOCAL ROLE usual_table_wallet_backend'); await tx.query(sql); })).rejects.toThrow();
});
it('delivers through the production wallet backend using a private login and preserves retry receipts', async () => {
  // The server separately typechecks its Cloudflare environment types; this suite runs its transport against local PostgreSQL.
  const backendModule = '../../../apps/server/src/walletBackend.ts';
  const { walletBackend } = await import(backendModule);
  const tasks: Promise<unknown>[] = [];
  const gateway = walletBackend({ WALLET_DB: { connectionString: backendConnection } }, { waitUntil: (task: Promise<unknown>) => { tasks.push(task); } });
  const accountId = await account(); const command = allocate(accountId, 'blackjack', 20000);
  const receipt = await gateway.execute(command); expect(receipt.wallet).toMatchObject({ availableUnits: 80000, atTablesUnits: 20000 });
  expect(await gateway.execute(command)).toEqual(receipt);
  await Promise.all(tasks); expect(tasks).toHaveLength(2);
  expect((await store.getWallet(accountId)).availableUnits).toBe(80000);
});

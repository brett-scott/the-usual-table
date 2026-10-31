import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blackjackUnitsToWallet, MAX_WALLET_UNITS, walletCommandSchema, walletUnitsToBlackjack,
  type GameId, type WalletCommand, type WalletSession } from '@casual/protocol';
import { PostgresWalletStore, type SqlTransaction, type WalletDatabase } from './index';

let db: PGlite;
let store: PostgresWalletStore;
const policies = { welcome: { version: 'test-only-v1', amountUnits: 100_000 },
  daily: { version: 'test-only-v1', amountUnits: 10_000, cooldownMs: 86_400_000 } };
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(await readFile(new URL('../migrations/001_wallet.sql', import.meta.url), 'utf8'));
  store = new PostgresWalletStore(db, policies);
}, 30_000);
afterAll(async () => { await db?.close(); });
const base = (accountId: string) => ({ contract: 1 as const, accountId, operationId: crypto.randomUUID() });
async function account(fund = true) {
  const id = crypto.randomUUID(); await store.createAccount(id);
  if (fund) await store.execute({ ...base(id), kind: 'claim_grant', source: 'welcome' });
  return id;
}
function allocation(accountId: string, gameId: GameId = 'blackjack', amountUnits = 20_000): WalletCommand & { kind: 'allocate' } {
  return { ...base(accountId), kind: 'allocate', sessionId: crypto.randomUUID(), roomId: crypto.randomUUID(), gameId, funding: 'account', amountUnits };
}
function next(session: WalletSession) {
  return { ...base(session.accountId), sessionId: session.sessionId, expectedVersion: session.version };
}
async function active(accountId: string, gameId: GameId = 'blackjack') {
  const pending = (await store.execute(allocation(accountId, gameId))).session!;
  return (await store.execute({ ...next(pending), kind: 'activate' })).session!;
}
function result(session: WalletSession, overrides: Partial<Extract<WalletCommand, { kind: 'settle' }>> = {}): Extract<WalletCommand, { kind: 'settle' }> {
  return { ...next(session), kind: 'settle', gameId: session.gameId, roomId: session.roomId, funding: 'account',
    sequence: session.resultSequence + 1, roundId: String(session.resultSequence + 1), rulesetVersion: 'test-rules-v1', wageredUnits: 1000, returnedUnits: 2000, ...overrides };
}
async function counts(accountId: string) {
  const { rows } = await db.query<{ operations: number; ledger: number; results: number }>(`SELECT
    (SELECT count(*)::int FROM wallet_private.operations WHERE account_id = $1) AS operations,
    (SELECT count(*)::int FROM wallet_private.ledger WHERE account_id = $1) AS ledger,
    (SELECT count(*)::int FROM wallet_private.results WHERE account_id = $1) AS results`, [accountId]);
  return rows[0];
}

describe('virtual chip contracts', () => {
  it('keeps the existing half-chip scale explicit and commission values exact', () => {
    expect(blackjackUnitsToWallet(2000)).toBe(100_000);
    expect(blackjackUnitsToWallet(1)).toBe(50);
    expect(walletUnitsToBlackjack(2500)).toBe(50);
    expect(walletUnitsToBlackjack(blackjackUnitsToWallet(41))).toBe(41);
    expect(() => walletUnitsToBlackjack(95)).toThrow('exact half-chip');
    for (const value of [-1, 0.5, Infinity, NaN, MAX_WALLET_UNITS]) expect(() => blackjackUnitsToWallet(value)).toThrow();
  });
  it('rejects guest funds, refill, client-set grants, decimals and incompatible versions', async () => {
    const id = await account(); const command = allocation(id);
    for (const invalid of [
      { ...command, contract: 2 }, { ...command, funding: 'guest' }, { ...command, amountUnits: -10 },
      { ...command, amountUnits: 1.5 }, { ...command, amountUnits: MAX_WALLET_UNITS + 1 },
      { ...base(id), kind: 'Refill' }, { ...base(id), kind: 'deposit_guest', amountUnits: 1000 },
      { ...base(id), kind: 'claim_grant', source: 'welcome', amountUnits: 1_000_000 },
    ]) expect(walletCommandSchema.safeParse(invalid).success).toBe(false);
    expect(await counts(id)).toEqual({ operations: 1, ledger: 1, results: 0 });
  });
});

describe('accounts and grants', () => {
  it('creates zero funds and cannot reset a wallet by creating the account again', async () => {
    const id = await account(false);
    expect(await store.getWallet(id)).toMatchObject({ currency: 'virtual-chips', unitsPerChip: 100, availableUnits: 0, version: 0 });
    await store.execute({ ...base(id), kind: 'claim_grant', source: 'welcome' });
    expect(await store.createAccount(id)).toMatchObject({ availableUnits: 100_000, version: 1 });
    await expect(store.getWallet(crypto.randomUUID())).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
  it('disables all grants until a trusted server policy is configured', async () => {
    const id = await account(false); const disabled = new PostgresWalletStore(db);
    for (const source of ['welcome', 'daily'] as const)
      await expect(disabled.execute({ ...base(id), kind: 'claim_grant', source })).rejects.toMatchObject({ code: 'GRANT_DISABLED' });
    expect((await store.getWallet(id)).availableUnits).toBe(0);
  });
  it('deduplicates retries and enforces one welcome grant across changed policy versions', async () => {
    const id = await account(false); const command: WalletCommand = { ...base(id), kind: 'claim_grant', source: 'welcome' };
    const replies = await Promise.all(Array.from({ length: 6 }, () => store.execute(command)));
    expect(replies.every(reply => JSON.stringify(reply) === JSON.stringify(replies[0]))).toBe(true);
    const newPolicy = new PostgresWalletStore(db, { welcome: { version: 'test-only-v2', amountUnits: 200_000 } });
    await expect(newPolicy.execute({ ...base(id), kind: 'claim_grant', source: 'welcome' })).rejects.toMatchObject({ code: 'GRANT_ALREADY_CLAIMED' });
    expect(await counts(id)).toEqual({ operations: 1, ledger: 1, results: 0 });
  });
  it('enforces the account-wide daily cooldown with database time and preserves issued eligibility on policy changes', async () => {
    const id = await account(); const command: WalletCommand = { ...base(id), kind: 'claim_grant', source: 'daily' };
    const attempts = await Promise.allSettled([store.execute(command), store.execute({ ...command, operationId: crypto.randomUUID() })]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    const changed = new PostgresWalletStore(db, { daily: { ...policies.daily, version: 'test-only-v2', cooldownMs: 1 } });
    await expect(changed.execute({ ...base(id), kind: 'claim_grant', source: 'daily' })).rejects.toMatchObject({ code: 'GRANT_COOLDOWN', retryAt: expect.any(Number) });
    expect((await store.getWallet(id)).availableUnits).toBe(110_000);
  });
  it('allows another allowance after the persisted eligibility time without accumulating missed days', async () => {
    // Tiny cooldown is a test fixture, not a production economy setting.
    const fixture = new PostgresWalletStore(db, { daily: { version: 'test-only-fast', amountUnits: 7, cooldownMs: 1 } });
    const id = await account(false);
    await fixture.execute({ ...base(id), kind: 'claim_grant', source: 'daily' });
    await db.query('SELECT pg_sleep(0.01)');
    await fixture.execute({ ...base(id), kind: 'claim_grant', source: 'daily' });
    expect((await store.getWallet(id)).availableUnits).toBe(14);
  });
});

describe('funded sessions and settlement', () => {
  it('prevents simultaneous cross-game allocations from spending the same balance', async () => {
    const id = await account();
    const attempts = await Promise.allSettled([store.execute(allocation(id, 'blackjack', 75_000)), store.execute(allocation(id, 'baccarat', 75_000))]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(attempt => attempt.status === 'rejected')).toMatchObject({ reason: { code: 'INSUFFICIENT_FUNDS' } });
    expect(await store.getWallet(id)).toMatchObject({ availableUnits: 25_000, atTablesUnits: 75_000, pendingReturnUnits: 0 });
    expect(await store.listOpenSessions(id)).toHaveLength(1);
  });
  it('keeps multiple game allocations distinct and rejects duplicate seats and session IDs', async () => {
    const id = await account(); const a = allocation(id); const b = allocation(id, 'roulette');
    await store.execute(a); await store.execute(b);
    await expect(store.execute({ ...a, operationId: crypto.randomUUID(), sessionId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'SESSION_EXISTS' });
    await expect(store.execute({ ...a, operationId: crypto.randomUUID(), roomId: 'another-room' })).rejects.toMatchObject({ code: 'SESSION_EXISTS' });
    expect(await store.getWallet(id)).toMatchObject({ availableUnits: 60_000, atTablesUnits: 40_000 });
    const other = await account();
    await expect(store.getSession(other, a.sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(store.execute({ ...base(other), kind: 'activate', sessionId: a.sessionId, expectedVersion: 1 })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect((await store.getWallet(other)).availableUnits).toBe(100_000);
  });
  it('requires activation, rejects stale versions and cancels only rejected pending allocations', async () => {
    const id = await account(); const command = allocation(id); const pending = (await store.execute(command)).session!;
    await expect(store.execute(result(pending))).rejects.toMatchObject({ code: 'SESSION_STATE' });
    const cancel: WalletCommand = { ...next(pending), kind: 'cancel_allocation', rejectionId: crypto.randomUUID() };
    const receipt = await store.execute(cancel);
    expect(receipt).toMatchObject({ wallet: { availableUnits: 100_000, atTablesUnits: 0 }, session: { state: 'cancelled', stackUnits: 0 } });
    expect(await store.execute(cancel)).toEqual(receipt);
    await expect(store.execute({ ...next(pending), kind: 'activate' })).rejects.toMatchObject({ code: 'STALE_SESSION' });
    const playing = await active(id);
    await expect(store.execute({ ...next(playing), kind: 'cancel_allocation', rejectionId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'SESSION_STATE' });
    await expect(store.execute({ ...next(playing), expectedVersion: 1, kind: 'request_return', finalSequence: 0, finalStackUnits: playing.stackUnits })).rejects.toMatchObject({ code: 'STALE_SESSION' });
  });
  it('records wins, pushes and losses once, keeping returned stakes out of profit', async () => {
    const id = await account(); let playing = await active(id);
    for (const returnedUnits of [2500, 1000, 0]) {
      const command = result(playing, { returnedUnits }); const receipt = await store.execute(command);
      expect(await store.execute(command)).toEqual(receipt); playing = receipt.session!;
    }
    expect(playing).toMatchObject({ resultSequence: 3, stackUnits: 20_500 });
    expect(await store.getWallet(id)).toMatchObject({ availableUnits: 80_000, atTablesUnits: 20_500 });
    expect(await counts(id)).toEqual({ operations: 6, ledger: 6, results: 3 });
    const { rows } = await db.query<{ net: number | string }>('SELECT sum(table_delta) AS net FROM wallet_private.ledger WHERE account_id = $1 AND kind = $2', [id, 'settle']);
    expect(Number(rows[0]!.net)).toBe(500);
  });
  it('rejects reordered or duplicate round events, wrong-game results and unaffordable wagers', async () => {
    const id = await account(); const playing = await active(id);
    await expect(store.execute(result(playing, { sequence: 2 }))).rejects.toMatchObject({ code: 'RESULT_ORDER' });
    await expect(store.execute(result(playing, { gameId: 'roulette' }))).rejects.toMatchObject({ code: 'WRONG_GAME' });
    await expect(store.execute(result(playing, { roomId: 'wrong-room' }))).rejects.toMatchObject({ code: 'WRONG_GAME' });
    await expect(store.execute(result(playing, { wageredUnits: 20_001 }))).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const settled = (await store.execute(result(playing))).session!;
    await expect(store.execute(result(settled, { roundId: '1' }))).rejects.toMatchObject({ code: 'RESULT_CONFLICT' });
    expect((await store.getSession(id, settled.sessionId)).resultSequence).toBe(1);
  });
  it('does not mint future poker pots through the house-result path', async () => {
    const id = await account(); const playing = await active(id, 'texas-holdem');
    await expect(store.execute(result(playing))).rejects.toMatchObject({ code: 'UNSUPPORTED_SETTLEMENT' });
  });
  it('accepts only one of two conflicting results for the same session version', async () => {
    const id = await account(); const playing = await active(id);
    const attempts = await Promise.allSettled([store.execute(result(playing)), store.execute(result(playing, { returnedUnits: 0 }))]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(attempt => attempt.status === 'rejected')).toMatchObject({ reason: { code: 'STALE_SESSION' } });
    expect((await counts(id))!.results).toBe(1);
  });
  it('rejects reused operation IDs with different content and returns historical receipts after subsequent writes', async () => {
    const id = await account(); const command = allocation(id); const first = await store.execute(command);
    await store.execute({ ...next(first.session!), kind: 'activate' });
    expect(await store.execute(command)).toEqual(first);
    await expect(store.execute({ ...command, amountUnits: 1 })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect((await store.getWallet(id)).version).toBeGreaterThan(first.wallet.version);
  });
  it('rolls back failed transactions, including result, receipt, ledger and balance changes', async () => {
    const id = await account(); const playing = await active(id); const command = result(playing);
    const before = await store.getWallet(id); const beforeCounts = await counts(id);
    const faulty: WalletDatabase = {
      query: db.query.bind(db),
      transaction: work => db.transaction(tx => work({ query: async <T>(sql: string, params?: unknown[]) => {
        if (sql.startsWith('INSERT INTO wallet_private.operations')) throw new Error('simulated crash before receipt');
        return tx.query<T>(sql, params);
      } } satisfies SqlTransaction)),
    };
    await expect(new PostgresWalletStore(faulty).execute(command)).rejects.toThrow('simulated crash');
    expect(await store.getWallet(id)).toEqual(before); expect(await counts(id)).toEqual(beforeCounts);
    expect(await store.getSession(id, playing.sessionId)).toEqual(playing);
    expect((await store.execute(command)).session?.resultSequence).toBe(1);
  });
  it('rejects overflow and rolls back the whole operation', async () => {
    const id = await account(); const playing = await active(id);
    await expect(store.execute(result(playing, { returnedUnits: MAX_WALLET_UNITS }))).rejects.toMatchObject({ code: 'BALANCE_LIMIT' });
    expect(await store.getSession(id, playing.sessionId)).toEqual(playing);
  });
});

describe('sealed returns and durable recovery', () => {
  it('waits for the final result watermark, separates pending returns and credits a cash-out once', async () => {
    const id = await account(); let playing = await active(id);
    await expect(store.execute({ ...next(playing), kind: 'request_return', finalSequence: 1, finalStackUnits: 21_000 })).rejects.toMatchObject({ code: 'RETURN_NOT_RECONCILED' });
    playing = (await store.execute(result(playing))).session!;
    await expect(store.execute({ ...next(playing), kind: 'complete_return' })).rejects.toMatchObject({ code: 'SESSION_STATE' });
    const sealed = await store.execute({ ...next(playing), kind: 'request_return', finalSequence: 1, finalStackUnits: playing.stackUnits });
    expect(sealed.wallet).toMatchObject({ availableUnits: 80_000, atTablesUnits: 0, pendingReturnUnits: 21_000 });
    await expect(store.execute(result(sealed.session!))).rejects.toMatchObject({ code: 'SESSION_STATE' });
    const cashOut: WalletCommand = { ...next(sealed.session!), kind: 'complete_return' };
    const replies = await Promise.all(Array.from({ length: 6 }, () => store.execute(cashOut)));
    expect(replies.every(reply => JSON.stringify(reply) === JSON.stringify(replies[0]))).toBe(true);
    expect(await store.getWallet(id)).toMatchObject({ availableUnits: 101_000, atTablesUnits: 0, pendingReturnUnits: 0 });
    expect(await store.listOpenSessions(id)).toEqual([]);
    await expect(store.execute({ ...cashOut, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'STALE_SESSION' });
    const reopened = await store.execute(allocation(id));
    expect(reopened.wallet).toMatchObject({ availableUnits: 81_000, atTablesUnits: 20_000 });
  });
  it('suspends new spending without losing committed results or trapping pending funds', async () => {
    const id = await account(); let playing = await active(id); await store.setAccountStatus(id, 'suspended');
    await expect(store.execute(allocation(id))).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    await expect(store.execute({ ...base(id), kind: 'claim_grant', source: 'daily' })).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    playing = (await store.execute(result(playing))).session!;
    const sealed = (await store.execute({ ...next(playing), kind: 'request_return', finalSequence: playing.resultSequence, finalStackUnits: playing.stackUnits })).session!;
    await store.execute({ ...next(sealed), kind: 'complete_return' });
    expect(await store.getWallet(id)).toMatchObject({ status: 'suspended', availableUnits: 101_000 });
  });
  it('retains uncertain activation, settled results, sealed returns and receipts across database reload', async () => {
    const id = await account(); const pending = (await store.execute(allocation(id))).session!;
    const playing = await active(id, 'baccarat'); const command = result(playing, { wageredUnits: 100, returnedUnits: 195 });
    const settled = (await store.execute(command)).session!;
    const sealed = (await store.execute({ ...next(settled), kind: 'request_return', finalSequence: 1, finalStackUnits: settled.stackUnits })).session!;
    const copy = await PGlite.create({ loadDataDir: await db.dumpDataDir() });
    try {
      const restored = new PostgresWalletStore(copy, policies);
      expect(await restored.listOpenSessions(id)).toEqual(expect.arrayContaining([pending, sealed]));
      expect((await restored.execute(command)).session).toEqual(settled);
      await restored.execute({ ...next(sealed), kind: 'complete_return' });
      expect(await restored.getWallet(id)).toMatchObject({ availableUnits: 80_095, atTablesUnits: 20_000, pendingReturnUnits: 0 });
      expect((await restored.getSession(id, pending.sessionId)).state).toBe('pending_activation');
    } finally { await copy.close(); }
  }, 30_000);
  it('makes ledger totals reconcile to funds and prevents edits to historical records', async () => {
    const id = await account(); const playing = await active(id); await store.execute(result(playing));
    const summary = await store.getWallet(id);
    const { rows } = await db.query<{ available: number | string; tables: number | string }>(
      'SELECT sum(available_delta) AS available, sum(table_delta) AS tables FROM wallet_private.ledger WHERE account_id = $1', [id]);
    expect(Number(rows[0]!.available)).toBe(summary.availableUnits);
    expect(Number(rows[0]!.tables)).toBe(summary.atTablesUnits + summary.pendingReturnUnits);
    for (const table of ['ledger', 'operations', 'results', 'grant_claims']) {
      await expect(db.query(`DELETE FROM wallet_private.${table} WHERE account_id = $1`, [id])).rejects.toThrow('append-only');
    }
  });
  it('keeps storage inaccessible to untrusted database roles even if schema usage is accidentally granted', async () => {
    const id = await account();
    await db.exec('CREATE ROLE wallet_test_client; GRANT USAGE ON SCHEMA wallet_private TO wallet_test_client');
    try {
      await db.exec('SET ROLE wallet_test_client');
      await expect(db.query('SELECT * FROM wallet_private.wallets')).rejects.toThrow('permission denied');
    } finally { await db.exec('RESET ROLE'); }
    // Simulate an accidental SELECT grant: RLS still hides every row from this role.
    await db.exec('GRANT SELECT ON wallet_private.wallets TO wallet_test_client');
    try {
      await db.exec('SET ROLE wallet_test_client');
      expect((await db.query('SELECT * FROM wallet_private.wallets WHERE account_id = $1', [id])).rows).toEqual([]);
      await expect(db.query('UPDATE wallet_private.wallets SET available_units = 100')).rejects.toThrow('permission denied');
    } finally { await db.exec('RESET ROLE'); }
  });
});

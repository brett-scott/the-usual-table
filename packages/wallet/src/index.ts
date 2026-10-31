import { z } from 'zod';
import {
  MAX_WALLET_UNITS, walletCommandSchema, walletReceiptSchema, walletSessionSchema, walletSummarySchema,
  type WalletCommand, type WalletReceipt, type WalletSession, type WalletSummary,
} from '@casual/protocol';

export interface SqlTransaction {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
/** Must hold one PostgreSQL connection until commit; rollback when the callback throws. */
export interface WalletDatabase extends SqlTransaction {
  transaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}
const grantPolicySchema = z.object({
  version: z.string().min(1).max(100), amountUnits: z.number().int().min(1).max(MAX_WALLET_UNITS),
}).strict();
const policySchema = z.object({
  welcome: grantPolicySchema.optional(),
  daily: grantPolicySchema.extend({ cooldownMs: z.number().int().min(1).max(31_536_000_000) }).optional(),
}).strict();
export type WalletGrantPolicies = z.infer<typeof policySchema>;
export type WalletErrorCode = 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_SUSPENDED' | 'OPERATION_CONFLICT' | 'GRANT_DISABLED'
  | 'GRANT_ALREADY_CLAIMED' | 'GRANT_COOLDOWN' | 'INSUFFICIENT_FUNDS' | 'SESSION_NOT_FOUND'
  | 'SESSION_EXISTS' | 'SESSION_STATE' | 'STALE_SESSION' | 'RESULT_ORDER' | 'RESULT_CONFLICT'
  | 'WRONG_GAME' | 'UNSUPPORTED_SETTLEMENT' | 'RETURN_NOT_RECONCILED' | 'BALANCE_LIMIT';
export class WalletError extends Error {
  constructor(public code: WalletErrorCode, public retryAt?: number) { super(code); this.name = 'WalletError'; }
}
function requireWallet(condition: unknown, code: WalletErrorCode): asserts condition {
  if (!condition) throw new WalletError(code);
}
function amount(value: number) {
  requireWallet(Number.isSafeInteger(value) && value >= 0 && value <= MAX_WALLET_UNITS, 'BALANCE_LIMIT');
  return value;
}
interface AccountRow { status: WalletSummary['status']; available: number | string }
interface SessionRow {
  sessionId: string; accountId: string; roomId: string; gameId: string; funding: string;
  state: string; stackUnits: number | string; version: number | string; resultSequence: number | string;
}
const sessionColumns = `session_id AS "sessionId", account_id AS "accountId", room_id AS "roomId", game_id AS "gameId",
  funding, state, stack_units AS "stackUnits", version, result_sequence AS "resultSequence"`;
function sessionValue(row: SessionRow): WalletSession {
  return walletSessionSchema.parse({ ...row, stackUnits: Number(row.stackUnits), version: Number(row.version), resultSequence: Number(row.resultSequence) });
}

/** Trusted account service only. No browser transport, arbitrary credit, refill or guest deposit. */
export class PostgresWalletStore {
  private readonly policies: WalletGrantPolicies;
  constructor(private readonly db: WalletDatabase, policies: WalletGrantPolicies = {}) {
    // Copy and validate trusted deployment policy; no rewards are enabled by default.
    this.policies = policySchema.parse(policies);
  }

  async createAccount(accountId: string): Promise<WalletSummary> {
    z.string().uuid().parse(accountId);
    return this.db.transaction(async tx => {
      const created = await tx.query('INSERT INTO wallet_private.accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING account_id', [accountId]);
      if (created.rows.length) await tx.query('INSERT INTO wallet_private.wallets (account_id) VALUES ($1)', [accountId]);
      return this.summary(tx, accountId);
    });
  }

  async getWallet(accountId: string): Promise<WalletSummary> {
    z.string().uuid().parse(accountId);
    return this.summary(this.db, accountId);
  }

  async getSession(accountId: string, sessionId: string): Promise<WalletSession> {
    z.string().uuid().parse(accountId); z.string().uuid().parse(sessionId);
    return this.session(this.db, accountId, sessionId);
  }

  /** Recovery scan includes uncertain allocations, active tables and sealed pending returns. */
  async listOpenSessions(accountId: string): Promise<WalletSession[]> {
    z.string().uuid().parse(accountId);
    const { rows } = await this.db.query<SessionRow>(`SELECT ${sessionColumns} FROM wallet_private.sessions
      WHERE account_id = $1 AND state NOT IN ('closed', 'cancelled') ORDER BY created_at, session_id`, [accountId]);
    return rows.map(sessionValue);
  }

  /** Suspension blocks new spending/grants; committed settlement and returns remain recoverable. */
  async setAccountStatus(accountId: string, status: WalletSummary['status']): Promise<void> {
    z.string().uuid().parse(accountId); z.enum(['active', 'suspended']).parse(status);
    await this.db.transaction(async tx => {
      await this.lock(tx, accountId);
      await tx.query('UPDATE wallet_private.accounts SET status = $2 WHERE account_id = $1', [accountId, status]);
      await tx.query('UPDATE wallet_private.wallets SET version = version + 1 WHERE account_id = $1', [accountId]);
    });
  }

  async execute(input: WalletCommand): Promise<WalletReceipt> {
    const command = walletCommandSchema.parse(input);
    return this.db.transaction(async tx => {
      // All mutations of this account lock the same row first, including cross-game allocations.
      const account = await this.lock(tx, command.accountId);
      const previous = await tx.query<{ matches: boolean; receipt: WalletReceipt }>(`SELECT request = $3::jsonb AS matches, receipt
        FROM wallet_private.operations WHERE account_id = $1 AND operation_id = $2`,
      [command.accountId, command.operationId, JSON.stringify(command)]);
      if (previous.rows[0]) {
        requireWallet(previous.rows[0].matches, 'OPERATION_CONFLICT');
        return walletReceiptSchema.parse(previous.rows[0].receipt);
      }
      if (['allocate', 'activate', 'claim_grant'].includes(command.kind)) requireWallet(account.status === 'active', 'ACCOUNT_SUSPENDED');
      let available = Number(account.available); let availableDelta = 0; let tableDelta = 0;
      let current: WalletSession | null = null; let policyVersion: string | null = null;
      if (command.kind === 'claim_grant') {
        const policy = this.policies[command.source];
        requireWallet(policy, 'GRANT_DISABLED'); policyVersion = policy.version;
        const last = await tx.query<{ retryAt: number | string | null }>(`SELECT extract(epoch FROM next_eligible_at) * 1000 AS "retryAt"
          FROM wallet_private.grant_claims WHERE account_id = $1 AND source = $2 ORDER BY claimed_at DESC LIMIT 1`, [command.accountId, command.source]);
        if (last.rows[0] && command.source === 'welcome') throw new WalletError('GRANT_ALREADY_CLAIMED');
        const clock = await tx.query<{ now: number | string }>('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now');
        const now = Number(clock.rows[0]!.now); const retryAt = Number(last.rows[0]?.retryAt ?? 0);
        if (retryAt > now) throw new WalletError('GRANT_COOLDOWN', Math.ceil(retryAt));
        const next = command.source === 'daily' ? now + this.policies.daily!.cooldownMs : null;
        availableDelta = policy.amountUnits; available = amount(available + availableDelta);
        await tx.query(`INSERT INTO wallet_private.grant_claims (account_id, operation_id, source, amount_units, policy_version, claimed_at, next_eligible_at)
          VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000), to_timestamp($7::double precision / 1000))`,
        [command.accountId, command.operationId, command.source, policy.amountUnits, policy.version, now, next]);
      } else if (command.kind === 'allocate') {
        const existing = await tx.query(`SELECT session_id FROM wallet_private.sessions WHERE session_id = $1 OR
          (account_id = $2 AND room_id = $3 AND state NOT IN ('closed', 'cancelled'))`, [command.sessionId, command.accountId, command.roomId]);
        requireWallet(existing.rows.length === 0, 'SESSION_EXISTS');
        requireWallet(available >= command.amountUnits, 'INSUFFICIENT_FUNDS');
        availableDelta = -command.amountUnits; tableDelta = command.amountUnits; available += availableDelta;
        await tx.query(`INSERT INTO wallet_private.sessions (session_id, account_id, room_id, game_id, state, stack_units)
          VALUES ($1, $2, $3, $4, 'pending_activation', $5)`, [command.sessionId, command.accountId, command.roomId, command.gameId, command.amountUnits]);
        current = await this.session(tx, command.accountId, command.sessionId);
      } else {
        current = await this.session(tx, command.accountId, command.sessionId);
        requireWallet(current.version === command.expectedVersion, 'STALE_SESSION');
        switch (command.kind) {
          case 'activate':
            requireWallet(current.state === 'pending_activation', 'SESSION_STATE'); current.state = 'active'; break;
          case 'cancel_allocation':
            requireWallet(current.state === 'pending_activation', 'SESSION_STATE');
            availableDelta = current.stackUnits; tableDelta = -current.stackUnits;
            current.stackUnits = 0; current.state = 'cancelled'; break;
          case 'settle': {
            requireWallet(current.state === 'active', 'SESSION_STATE');
            requireWallet(current.gameId === command.gameId && current.roomId === command.roomId, 'WRONG_GAME');
            // Poker requires a balanced multi-account transfer operation, never house-minted pot credits.
            requireWallet(current.gameId !== 'texas-holdem', 'UNSUPPORTED_SETTLEMENT');
            const duplicate = await tx.query('SELECT sequence FROM wallet_private.results WHERE session_id = $1 AND round_id = $2', [current.sessionId, command.roundId]);
            requireWallet(duplicate.rows.length === 0, 'RESULT_CONFLICT');
            requireWallet(command.sequence === current.resultSequence + 1, 'RESULT_ORDER');
            requireWallet(command.wageredUnits <= current.stackUnits, 'INSUFFICIENT_FUNDS');
            tableDelta = command.returnedUnits - command.wageredUnits;
            current.stackUnits = amount(current.stackUnits - command.wageredUnits + command.returnedUnits);
            current.resultSequence = command.sequence;
            await tx.query(`INSERT INTO wallet_private.results (account_id, operation_id, session_id, sequence, round_id, ruleset_version, wagered_units, returned_units)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [command.accountId, command.operationId, current.sessionId, command.sequence,
              command.roundId, command.rulesetVersion, command.wageredUnits, command.returnedUnits]);
            break;
          }
          case 'request_return':
            requireWallet(current.state === 'active', 'SESSION_STATE');
            requireWallet(command.finalSequence === current.resultSequence && command.finalStackUnits === current.stackUnits, 'RETURN_NOT_RECONCILED');
            current.state = 'returning'; break;
          case 'complete_return':
            requireWallet(current.state === 'returning', 'SESSION_STATE');
            availableDelta = current.stackUnits; tableDelta = -current.stackUnits;
            current.stackUnits = 0; current.state = 'closed'; break;
        }
        available = amount(available + availableDelta); current.version++;
        await tx.query(`UPDATE wallet_private.sessions SET state = $3, stack_units = $4, version = $5, result_sequence = $6,
          updated_at = clock_timestamp() WHERE account_id = $1 AND session_id = $2`,
        [command.accountId, current.sessionId, current.state, current.stackUnits, current.version, current.resultSequence]);
      }
      await tx.query('UPDATE wallet_private.wallets SET available_units = $2, version = version + 1 WHERE account_id = $1', [command.accountId, available]);
      const receipt = walletReceiptSchema.parse({ operationId: command.operationId, wallet: await this.summary(tx, command.accountId), session: current });
      await tx.query(`INSERT INTO wallet_private.ledger (account_id, operation_id, kind, session_id, available_delta, table_delta, available_after, stack_after, policy_version, wallet_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [command.accountId, command.operationId, command.kind, current?.sessionId ?? null,
        availableDelta, tableDelta, available, current?.stackUnits ?? null, policyVersion, receipt.wallet.version]);
      await tx.query('INSERT INTO wallet_private.operations (account_id, operation_id, request, receipt) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
        [command.accountId, command.operationId, JSON.stringify(command), JSON.stringify(receipt)]);
      return receipt;
    });
  }

  private async lock(tx: SqlTransaction, accountId: string): Promise<AccountRow> {
    const { rows } = await tx.query<AccountRow>(`SELECT a.status, w.available_units AS available FROM wallet_private.accounts a
      JOIN wallet_private.wallets w USING (account_id) WHERE account_id = $1 FOR UPDATE OF a, w`, [accountId]);
    requireWallet(rows[0], 'ACCOUNT_NOT_FOUND'); return rows[0];
  }
  private async session(tx: SqlTransaction, accountId: string, sessionId: string): Promise<WalletSession> {
    const { rows } = await tx.query<SessionRow>(`SELECT ${sessionColumns} FROM wallet_private.sessions WHERE account_id = $1 AND session_id = $2`, [accountId, sessionId]);
    requireWallet(rows[0], 'SESSION_NOT_FOUND'); return sessionValue(rows[0]);
  }
  private async summary(tx: SqlTransaction, accountId: string): Promise<WalletSummary> {
    const { rows } = await tx.query<{ status: string; version: number | string; available: number | string; tables: number | string; pending: number | string }>(`
      SELECT a.status, w.version, w.available_units AS available,
        coalesce(sum(s.stack_units) FILTER (WHERE s.state IN ('pending_activation', 'active')), 0) AS tables,
        coalesce(sum(s.stack_units) FILTER (WHERE s.state = 'returning'), 0) AS pending
      FROM wallet_private.accounts a JOIN wallet_private.wallets w USING (account_id)
      LEFT JOIN wallet_private.sessions s USING (account_id) WHERE a.account_id = $1 GROUP BY a.account_id, w.account_id`, [accountId]);
    requireWallet(rows[0], 'ACCOUNT_NOT_FOUND'); const row = rows[0];
    return walletSummarySchema.parse({ contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId, status: row.status,
      version: Number(row.version), availableUnits: Number(row.available), atTablesUnits: Number(row.tables), pendingReturnUnits: Number(row.pending) });
  }
}

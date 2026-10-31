import type { Pool } from 'pg';
import type { SqlTransaction, WalletDatabase } from './index';

/** A single checked-out connection owns BEGIN through COMMIT/ROLLBACK. Never use pool.query inside it. */
export function postgresWalletDatabase(pool: Pool): WalletDatabase {
  return {
    async query<T>(sql: string, params?: unknown[]) { return pool.query(sql, params) as unknown as Promise<{ rows: T[] }>; },
    async transaction<T>(work: (tx: SqlTransaction) => Promise<T>) {
      const client = await pool.connect(); let discard = false;
      try {
        await client.query('BEGIN');
        const result = await work({ async query<R>(sql: string, params?: unknown[]) { return client.query(sql, params) as unknown as Promise<{ rows: R[] }>; } });
        await client.query('COMMIT'); return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
  };
}

import type { Pool } from 'pg';
import type { SqlTransaction, WalletDatabase } from './index';

/** Register immediately after creating a pool. pg can finish pool.end() before its clients emit end. */
export function postgresPoolCloser(pool: Pool): () => Promise<void> {
  const connections = new Set<Promise<void>>();
  let failure: (Error & { code?: string }) | undefined;
  pool.on('connect', client => {
    const closed = new Promise<void>(resolve => { client.once('end', resolve); });
    connections.add(closed);
    void closed.then(() => { connections.delete(closed); });
  });
  pool.on('error', error => {
    const code = (error as Error & { code?: unknown }).code;
    // Report idle failures through the operation/teardown promise, without serializing client credentials.
    failure ??= Object.assign(new Error('PostgreSQL pool connection failed.'), { code: typeof code === 'string' ? code : undefined });
  });
  return async () => {
    await pool.end();
    await Promise.all(connections);
    if (failure) throw failure;
  };
}

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

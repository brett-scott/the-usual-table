import { Pool } from 'pg';
import { PostgresWalletStore } from '@casual/wallet';
import { postgresWalletDatabase } from '@casual/wallet/postgres';
import type { Env } from './env';
import type { WalletGateway } from './roomWallet';

/** Each delivery owns its connections; Hyperdrive pools the underlying database sockets. */
export function walletBackend(env: Env, context: { waitUntil(task: Promise<unknown>): void }): WalletGateway | undefined {
  if (env.WALLET_SERVICE) return env.WALLET_SERVICE;
  if (!env.WALLET_DB) return undefined;
  return { execute(command) {
    const task = (async () => {
      const pool = new Pool({ connectionString: env.WALLET_DB!.connectionString, max: 1, connectionTimeoutMillis: 2000 });
      try {
        const database = postgresWalletDatabase(pool);
        const store = new PostgresWalletStore({ ...database, transaction: work => database.transaction(async tx => {
          await tx.query("SET LOCAL statement_timeout = '3000ms'");
          await tx.query("SET LOCAL lock_timeout = '2000ms'");
          return work(tx);
        }) });
        return await store.execute(command);
      } finally { await pool.end(); }
    })();
    // A room timeout is an uncertain acknowledgement, not permission to abandon the transaction.
    context.waitUntil(task.catch(() => undefined));
    return task;
  } };
}

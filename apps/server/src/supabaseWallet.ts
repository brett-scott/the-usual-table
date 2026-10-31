import { GameError } from '@casual/engine';
import { PUBLIC_SUPABASE_CONFIG, publicAuthConfigSchema, supabaseUrlSchema, walletSummarySchema, type AccountSession } from '@casual/protocol';
import type { Env } from './env';

/** Narrow, caller-scoped RPCs. The public key identifies the app; the user's verified JWT owns the wallet. */
export async function supabaseWallet(request: Request, env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_PUBLISHABLE_KEY'>, account: AccountSession, ensure = false) {
  const url = supabaseUrlSchema.safeParse(env.SUPABASE_URL ?? PUBLIC_SUPABASE_CONFIG.url);
  const config = publicAuthConfigSchema.safeParse({ url: url.success ? url.data : '', publishableKey: env.SUPABASE_PUBLISHABLE_KEY
    ?? (url.success && url.data === PUBLIC_SUPABASE_CONFIG.url ? PUBLIC_SUPABASE_CONFIG.publishableKey : '') });
  if (!config.success) throw new GameError('WALLET_NOT_CONNECTED', 'Saved wallets are not configured for this project yet.');
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3000)]);
    const response = await fetch(`${config.data.url}/rest/v1/rpc/${ensure ? 'usual_table_ensure_wallet' : 'usual_table_wallet_summary'}`, {
      method: 'POST', headers: { apikey: config.data.publishableKey, Authorization: request.headers.get('Authorization')!, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', cache: 'no-store', signal,
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = value && typeof value === 'object' && 'code' in value ? value.code : '';
      if (['PGRST202', 'PGRST205', '42P01', '3F000', '42883'].includes(String(code))) throw new GameError('WALLET_NOT_CONNECTED', 'Saved wallet storage needs setup. Please try again later.');
      if (response.status === 401 || response.status === 403) throw new GameError('ACCOUNT_SESSION_INVALID', 'Your wallet session could not be verified. Sign in again.');
      throw new Error('Wallet service rejected the request');
    }
    if (value === null && !ensure) throw new GameError('WALLET_NOT_FOUND', 'Create your saved wallet to view its balance.');
    const wallet = walletSummarySchema.parse(value);
    if (wallet.accountId !== account.accountId) throw new Error('Wallet account mismatch');
    return wallet;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError('WALLET_UNAVAILABLE', 'Your wallet balance could not be loaded. Please try again.');
  }
}

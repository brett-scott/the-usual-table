import { GameError } from '@casual/engine';
import { verifyAccountSession } from './accountAuth';
import { supabaseWallet } from './supabaseWallet';
import type { Env } from './env';

export const ACCOUNT_LEASE_MS = 90_000;
/** Check the current Auth user and wallet status as well as the signed token. */
export async function verifyPlayingAccount(request: Request, env: Env) {
  const account = await verifyAccountSession(request, env);
  let wallet;
  try { wallet = await supabaseWallet(request, env, account); }
  catch (error) {
    if (!(error instanceof GameError && error.code === 'WALLET_NOT_FOUND')) throw error;
    wallet = await supabaseWallet(request, env, account, true);
  }
  if (wallet.status !== 'active') throw new GameError('ACCOUNT_SUSPENDED', 'Your saved wallet is paused.');
  return { id: account.accountId, expiresAt: Math.min(account.expiresAt, Date.now() + ACCOUNT_LEASE_MS) };
}

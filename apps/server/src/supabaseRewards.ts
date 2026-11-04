import { GameError } from '@casual/engine';
import { allowanceSchema, progressionSchema, PUBLIC_SUPABASE_CONFIG, publicAuthConfigSchema, type AccountSession } from '@casual/protocol';
import type { Env } from './env';
export async function supabaseAllowance(request: Request, env: Env, account: AccountSession, progression = false) {
  const config = publicAuthConfigSchema.safeParse({ url: env.SUPABASE_URL ?? PUBLIC_SUPABASE_CONFIG.url,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? (!env.SUPABASE_URL || env.SUPABASE_URL === PUBLIC_SUPABASE_CONFIG.url ? PUBLIC_SUPABASE_CONFIG.publishableKey : '') });
  if (!config.success) throw new GameError('REWARDS_NOT_CONNECTED', 'Account rewards need setup.');
  try {
    const rpc = progression ? request.method === 'POST' ? 'usual_table_claim_rewards' : 'usual_table_progression' : request.method === 'POST' ? 'usual_table_claim_allowance' : 'usual_table_allowance';
    const response = await fetch(`${config.data.url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers: { apikey: config.data.publishableKey, Authorization: request.headers.get('Authorization')!, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'manual', cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected redirect');
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
      if (['PGRST202','42P01','42883'].includes(code)) throw new GameError('REWARDS_NOT_CONNECTED','Account rewards need setup.');
      if ([401,403].includes(response.status)) throw new GameError('ACCOUNT_SESSION_INVALID','Sign in again or check that your wallet is active.');
      throw new Error('Rewards unavailable');
    }
    const data = progression ? progressionSchema.parse(value) : allowanceSchema.parse(value);
    if (data.accountId !== account.accountId) throw new Error('Wrong account');
    return data;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError('REWARDS_UNAVAILABLE','Your rewards could not be loaded. Please try again.');
  }
}

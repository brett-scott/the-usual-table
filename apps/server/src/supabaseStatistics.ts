import { GameError } from '@casual/engine';
import { accountStatisticsSchema, detailedStatisticsSchema, PUBLIC_SUPABASE_CONFIG, publicAuthConfigSchema, supabaseUrlSchema, type AccountSession } from '@casual/protocol';
import type { Env } from './env';

export async function supabaseStatistics(request: Request, env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_PUBLISHABLE_KEY'>, account: AccountSession, detailed = false) {
  const url = supabaseUrlSchema.safeParse(env.SUPABASE_URL ?? PUBLIC_SUPABASE_CONFIG.url);
  const config = publicAuthConfigSchema.safeParse({ url: url.success ? url.data : '', publishableKey: env.SUPABASE_PUBLISHABLE_KEY
    ?? (url.success && url.data === PUBLIC_SUPABASE_CONFIG.url ? PUBLIC_SUPABASE_CONFIG.publishableKey : '') });
  if (!config.success) throw new GameError('STATISTICS_NOT_CONNECTED', 'Account statistics are not configured for this project yet.');
  try {
    const response = await fetch(`${config.data.url}/rest/v1/rpc/${detailed ? new URL(request.url).searchParams.get('version')==='6'?'usual_table_detailed_statistics_v6':new URL(request.url).searchParams.get('version')==='5'?'usual_table_detailed_statistics_v5':new URL(request.url).searchParams.get('version')==='4'?'usual_table_detailed_statistics_v4':'usual_table_detailed_statistics_v3' : 'usual_table_account_statistics'}`, {
      method: 'POST', headers: { apikey: config.data.publishableKey, Authorization: request.headers.get('Authorization')!, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'manual', cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
    });
    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected statistics redirect');
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
      if (['PGRST202', 'PGRST205', '42P01', '3F000', '42883'].includes(code)) throw new GameError('STATISTICS_NOT_CONNECTED', 'Account statistics need setup. Please try again later.');
      if (response.status === 401 || response.status === 403) throw new GameError('ACCOUNT_SESSION_INVALID', 'Sign in again to view your statistics.');
      throw new Error('Statistics service rejected the request');
    }
    const statistics = detailed ? detailedStatisticsSchema.parse(value) : accountStatisticsSchema.parse(value);
    if (statistics.accountId !== account.accountId) throw new Error('Statistics account mismatch');
    return statistics;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw new GameError('STATISTICS_UNAVAILABLE', 'Your statistics could not be loaded. Please try again.');
  }
}

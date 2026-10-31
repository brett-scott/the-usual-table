import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { accountSessionSchema, PUBLIC_SUPABASE_CONFIG, supabaseUrlSchema, type AccountSession } from '@casual/protocol';
import { GameError } from '@casual/engine';
import type { Env } from './env';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function keys(url: string) {
  let resolver = keySets.get(url);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), { timeoutDuration: 5000, cooldownDuration: 10_000, cacheMaxAge: 600_000 });
    keySets.set(url, resolver);
  }
  return resolver;
}
/** The fixed server project selects issuer/keys. No browser identity header, decoded token or provider token is proof. */
export async function verifyAccountSession(request: Request, env: Pick<Env, 'SUPABASE_URL'>, resolver?: JWTVerifyGetKey): Promise<AccountSession> {
  const authorization = request.headers.get('Authorization') ?? '';
  if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) throw new GameError('ACCOUNT_SESSION_INVALID', 'Sign in to connect your account.');
  const parsed = supabaseUrlSchema.safeParse(env.SUPABASE_URL ?? PUBLIC_SUPABASE_CONFIG.url);
  if (!parsed.success) throw new GameError('AUTH_UNAVAILABLE', 'Account sign-in is unavailable. You can still play as a guest.');
  try {
    const { payload } = await jwtVerify(authorization.slice(7), resolver ?? keys(parsed.data), {
      issuer: `${parsed.data}/auth/v1`, audience: 'authenticated', algorithms: ['ES256', 'RS256'], requiredClaims: ['sub', 'exp', 'iat', 'iss', 'aud'],
    });
    const metadata = payload.app_metadata as { provider?: unknown } | undefined;
    const methods = payload.amr;
    if (payload.role !== 'authenticated' || payload.is_anonymous === true || !Array.isArray(methods)
      || !methods.some(method => method && typeof method === 'object' && method.method === 'oauth')
      || methods.some(method => method && typeof method === 'object' && ['password', 'otp', 'anonymous'].includes(method.method))) {
      throw new Error('Social sign-in required');
    }
    return accountSessionSchema.parse({ accountId: payload.sub, provider: metadata?.provider, expiresAt: payload.exp! * 1000 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(String(code)) || error instanceof TypeError) throw new GameError('AUTH_UNAVAILABLE', 'Account sign-in is unavailable. You can still play as a guest.');
    throw new GameError('ACCOUNT_SESSION_INVALID', 'Your account session could not be verified. Sign in again.');
  }
}

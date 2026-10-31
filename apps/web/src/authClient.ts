import type { Session, User } from '@supabase/supabase-js';
import { z } from 'zod';
import { accountSessionSchema, displayNameSchema, playerIconSchema, PUBLIC_SUPABASE_CONFIG, publicAuthConfigSchema, socialProviderSchema, walletSummarySchema,
  type AccountSession, type PlayerIcon, type SocialProvider, type WalletSummary } from '@casual/protocol';

export interface AuthState {
  callbackPending: boolean; working: boolean; hasSession: boolean; account: AccountSession | null; error: string;
  nickname: string | null; nicknameStatus: 'idle' | 'loading' | 'ready' | 'error'; savingNickname: boolean; nicknameError: string;
  playerIcon: PlayerIcon | null;
  wallet: WalletSummary | null; walletStatus: 'idle' | 'loading' | 'ready' | 'not-connected' | 'error';
}
// Editable display metadata only. Account identity and permissions always use the verified UUID.
export const ACCOUNT_NICKNAME_KEY = 'usual_table_nickname';
export const ACCOUNT_ICON_KEY = 'usual_table_player_icon';
function nicknameOf(user: User) { return displayNameSchema.safeParse(user.user_metadata?.[ACCOUNT_NICKNAME_KEY]).data ?? null; }
function iconOf(user: User) { return playerIconSchema.safeParse(user.user_metadata?.[ACCOUNT_ICON_KEY]).data ?? null; }
interface SessionResult { data: { session: Session | null }; error: Error | null }
export interface AuthSdk {
  getSession(): Promise<SessionResult>;
  getUser(): Promise<{ data: { user: User | null }; error: Error | null }>;
  updateUser(input: { data: Record<string, string | null> }): Promise<{ data: { user: User | null }; error: Error | null }>;
  exchangeCodeForSession(code: string, options?: { flowId: string }): Promise<SessionResult>;
  signInWithOAuth(input: { provider: SocialProvider; options: { redirectTo: string; skipBrowserRedirect: true } }): Promise<{ data: { url: string | null; flowId?: string | null }; error: Error | null }>;
  signOut(options: { scope: 'local' }): Promise<{ error: Error | null }>;
  onAuthStateChange(callback: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
}
export interface AuthEnvironment {
  url(): URL; baseUrl: string; now(): number;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  replace(url: string): void; navigate(url: string): void;
  verify(token: string, signal: AbortSignal): Promise<AccountSession>;
  readWallet(token: string, signal: AbortSignal): Promise<WalletSummary | null>;
}
const INTENT_KEY = 'usual-auth-intent';
const intentSchema = z.object({ version: z.literal(1), provider: socialProviderSchema,
  hash: z.string(), createdAt: z.number().int().nonnegative(), flowId: z.string().min(1).max(200).optional() }).strict();
export function safeAuthDestination(hash: string) {
  return /^(#\/games(?:\/blackjack(?:\/lobbies)?)?|#\/room\/[a-f0-9]{32})$/.test(hash) ? hash : '#/games';
}
export function authCallback(url: URL) {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const implicit = fragment.has('access_token') || fragment.has('refresh_token');
  const error = url.searchParams.has('error') || fragment.has('error') || implicit;
  return { present: error || url.searchParams.has('code') || url.searchParams.has('sb_flow_id'),
    code: url.searchParams.getAll('code').length === 1 ? url.searchParams.get('code') : null,
    flowId: url.searchParams.get('sb_flow_id'), error };
}
export function cleanAuthCallback(url: URL): URL {
  const clean = new URL(url);
  for (const key of ['code', 'sb_flow_id', 'error', 'error_code', 'error_description']) clean.searchParams.delete(key);
  const fragment = new URLSearchParams(clean.hash.slice(1));
  if (['access_token', 'refresh_token', 'error'].some(key => fragment.has(key))) clean.hash = '';
  return clean;
}

/** One SDK owns session persistence/refresh. This store only exposes server-verified public account data. */
export class AuthController {
  private state: AuthState;
  private readonly listeners = new Set<() => void>();
  private startPromise?: Promise<void>;
  private verification?: AbortController;
  private generation = 0;
  private pendingToken = '';
  private pendingVerification?: Promise<void>;
  private handlingCallback: boolean;
  private startingSignIn = false;
  private loginGeneration = 0;
  private walletRequest?: AbortController;
  private walletGeneration = 0;
  constructor(private readonly sdk: AuthSdk, private readonly env: AuthEnvironment, private readonly projectUrl: string, private readonly enabled = true) {
    this.handlingCallback = authCallback(env.url()).present;
    this.state = { callbackPending: this.handlingCallback, working: this.handlingCallback, hasSession: false, account: null, error: '',
      nickname: null, nicknameStatus: 'idle', savingNickname: false, nicknameError: '', playerIcon: null, wallet: null, walletStatus: 'idle' };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<AuthState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  start(): Promise<void> {
    this.startPromise ??= this.initialize(); return this.startPromise;
  }
  private async initialize() {
    if (!this.enabled) {
      this.env.replace(cleanAuthCallback(this.env.url()).href);
      this.publish({ callbackPending: false, working: false, error: 'Account sign-in is unavailable. You can still play as a guest.' });
      return;
    }
    // Do not await Supabase methods inside an auth event: the SDK holds its session lock there.
    this.sdk.onAuthStateChange((event, session) => {
      if (this.handlingCallback) return;
      queueMicrotask(() => {
        if (event === 'USER_UPDATED' && session && this.state.account?.accountId === session.user.id && this.state.account.expiresAt > this.env.now()) {
          // updateUser emits while holding the SDK lock. Its caller handles its own save result.
          if (!this.state.savingNickname) this.publish({ nickname: nicknameOf(session.user), playerIcon: iconOf(session.user), nicknameStatus: 'ready', nicknameError: '' });
          return;
        }
        void this.acceptSession(session);
      });
    });
    if (this.handlingCallback) {
      const callback = authCallback(this.env.url()); let hash = '#/games';
      this.env.replace(cleanAuthCallback(this.env.url()).href);
      try {
        const raw = this.env.storage.getItem(INTENT_KEY); this.env.storage.removeItem(INTENT_KEY);
        const intent = intentSchema.parse(JSON.parse(raw ?? 'null'));
        hash = safeAuthDestination(intent.hash);
        if (callback.error) throw new Error('cancelled');
        if (!callback.code || callback.code.length > 2048 || this.env.now() - intent.createdAt > 15 * 60_000
          || intent.createdAt > this.env.now()) throw new Error('expired');
        if (callback.flowId && callback.flowId !== intent.flowId) throw new Error('Callback flow mismatch');
        const { data, error } = await this.sdk.exchangeCodeForSession(callback.code, intent.flowId ? { flowId: intent.flowId } : undefined);
        if (error || !data.session) throw new Error('exchange failed');
        await this.acceptSession(data.session);
      } catch {
        this.publish({ error: 'Sign-in did not complete. Try Google or Discord again, or continue as a guest.' });
      } finally {
        this.env.replace(`${this.env.baseUrl}${hash}`);
        this.handlingCallback = false; this.publish({ callbackPending: false, working: false });
      }
      return;
    }
    await this.retry();
  }
  async retry() {
    try {
      const { data, error } = await this.sdk.getSession();
      if (error) throw error;
      await this.acceptSession(data.session);
    } catch { this.publish({ working: false, error: 'Account sign-in is unavailable. You can still play as a guest.' }); }
  }
  private acceptSession(session: Session | null): Promise<void> {
    if (!session) {
      this.generation++; this.verification?.abort(); this.pendingToken = ''; this.pendingVerification = undefined;
      this.walletGeneration++; this.walletRequest?.abort();
      this.publish({ account: null, hasSession: false, working: this.startingSignIn,
        nickname: null, nicknameStatus: 'idle', savingNickname: false, nicknameError: '', playerIcon: null, wallet: null, walletStatus: 'idle' }); return Promise.resolve();
    }
    if (this.pendingToken === session.access_token && this.pendingVerification) return this.pendingVerification;
    const generation = ++this.generation; this.verification?.abort();
    this.walletGeneration++; this.walletRequest?.abort();
    const request = new AbortController(); this.verification = request; this.pendingToken = session.access_token;
    const continuing = this.state.account?.accountId === session.user.id && this.state.account.expiresAt > this.env.now();
    this.publish({ working: true, hasSession: true, error: '', wallet: null, walletStatus: 'idle',
      ...(!continuing ? { account: null, nickname: null, nicknameStatus: 'loading' as const, savingNickname: false, nicknameError: '', playerIcon: null } : {}) });
    this.pendingVerification = (async () => {
      try {
        const account = accountSessionSchema.parse(await this.env.verify(session.access_token, request.signal));
        if (account.accountId !== session.user.id || account.expiresAt <= this.env.now()) throw new Error('Account session mismatch');
        if (generation !== this.generation) return;
        this.publish({ account, working: false, error: '' });
        try {
          // Read from Auth rather than a stale browser session so edits on another device survive reload.
          const { data, error } = await this.sdk.getUser();
          if (error || data.user?.id !== account.accountId) throw new Error('Nickname unavailable');
          if (generation === this.generation) this.publish({ nickname: nicknameOf(data.user), playerIcon: iconOf(data.user), nicknameStatus: 'ready' });
        } catch {
          if (generation === this.generation) this.publish({ nicknameStatus: 'error', nicknameError: 'Your nickname could not be loaded. Check your connection and retry.' });
        }
      } catch {
        if (generation === this.generation) this.publish({ account: null, working: false,
          error: 'Your account could not be connected. Retry sign-in, or keep playing as a guest.' });
      } finally {
        if (generation === this.generation) { this.pendingToken = ''; this.pendingVerification = undefined; }
      }
    })();
    return this.pendingVerification;
  }
  async signIn(provider: SocialProvider) {
    if (!this.enabled) { this.publish({ error: 'Account sign-in is unavailable. You can still play as a guest.' }); return; }
    if (this.state.working || this.startingSignIn) return;
    this.startingSignIn = true; const generation = ++this.loginGeneration;
    this.publish({ working: true, error: '' });
    try {
      socialProviderSchema.parse(provider);
      const intent = { version: 1, provider, hash: safeAuthDestination(this.env.url().hash), createdAt: this.env.now() };
      this.env.storage.setItem(INTENT_KEY, JSON.stringify(intent));
      const { data, error } = await this.sdk.signInWithOAuth({ provider, options: { redirectTo: this.env.baseUrl, skipBrowserRedirect: true } });
      if (generation !== this.loginGeneration) return;
      if (error || !data.url) throw new Error('Provider unavailable');
      const destination = new URL(data.url);
      if (destination.origin !== this.projectUrl || destination.pathname !== '/auth/v1/authorize' || destination.searchParams.get('provider') !== provider) throw new Error('Unexpected sign-in URL');
      // Recent SDK versions keep one verifier per flow. Carry its public selector in this tab's intent.
      this.env.storage.setItem(INTENT_KEY, JSON.stringify({ ...intent, ...(data.flowId ? { flowId: data.flowId } : {}) }));
      this.env.navigate(destination.href);
    } catch {
      if (generation !== this.loginGeneration) return;
      this.startingSignIn = false;
      try { this.env.storage.removeItem(INTENT_KEY); } catch { /* Guests do not require browser storage. */ }
      this.publish({ working: false, error: 'Sign-in could not start. Check browser storage and try again, or continue as a guest.' });
    }
  }
  cancelSignIn() {
    if (!this.startingSignIn) return;
    this.loginGeneration++; this.startingSignIn = false;
    try { this.env.storage.removeItem(INTENT_KEY); } catch { /* Guest entry works without browser storage. */ }
    this.publish({ working: false });
  }
  async saveNickname(value: string, icon: PlayerIcon | null = this.state.playerIcon): Promise<boolean> {
    const account = this.state.account;
    if (!account || account.expiresAt <= this.env.now() || this.state.working || this.state.savingNickname || this.state.nicknameStatus !== 'ready') return false;
    const parsed = displayNameSchema.safeParse(value);
    if (!parsed.success) { this.publish({ nicknameError: parsed.error.issues[0]!.message }); return false; }
    const parsedIcon = playerIconSchema.nullable().safeParse(icon);
    if (!parsedIcon.success) { this.publish({ nicknameError: 'Choose an available player icon.' }); return false; }
    const generation = this.generation;
    this.publish({ savingNickname: true, nicknameError: '' });
    try {
      const { data, error } = await this.sdk.updateUser({ data: { [ACCOUNT_NICKNAME_KEY]: parsed.data, [ACCOUNT_ICON_KEY]: parsedIcon.data } });
      if (error || data.user?.id !== account.accountId || nicknameOf(data.user) !== parsed.data || iconOf(data.user) !== parsedIcon.data) throw new Error('Profile update failed');
      if (generation !== this.generation) return false;
      this.publish({ nickname: parsed.data, playerIcon: parsedIcon.data, nicknameStatus: 'ready', savingNickname: false }); return true;
    } catch {
      if (generation === this.generation) this.publish({ savingNickname: false, nicknameError: 'Your profile could not be saved. Check your connection and try again.' });
      return false;
    }
  }
  async refreshWallet() {
    const account = this.state.account;
    if (!account || account.expiresAt <= this.env.now() || this.state.walletStatus === 'loading') return;
    const generation = ++this.walletGeneration; this.walletRequest?.abort();
    const request = new AbortController(); this.walletRequest = request;
    this.publish({ wallet: null, walletStatus: 'loading' });
    try {
      const { data, error } = await this.sdk.getSession();
      if (error || !data.session || data.session.user.id !== account.accountId) throw new Error('Account session mismatch');
      if (generation !== this.walletGeneration) return;
      const result = await this.env.readWallet(data.session.access_token, request.signal);
      const wallet = result === null ? null : walletSummarySchema.parse(result);
      if (wallet && wallet.accountId !== account.accountId) throw new Error('Wallet account mismatch');
      if (generation === this.walletGeneration) this.publish({ wallet, walletStatus: wallet ? 'ready' : 'not-connected' });
    } catch {
      if (generation === this.walletGeneration) this.publish({ wallet: null, walletStatus: 'error' });
    }
  }
  async accessToken() {
    const account = this.state.account;
    const { data, error } = await this.sdk.getSession();
    if (error || !account || !data.session || data.session.user.id !== account.accountId || this.state.account?.accountId !== account.accountId)
      throw new Error('Sign in again to use your saved chips.');
    return data.session.access_token;
  }
  async signOut() {
    this.walletGeneration++; this.walletRequest?.abort();
    this.generation++; this.verification?.abort(); this.publish({ working: true, account: null,
      nickname: null, nicknameStatus: 'idle', savingNickname: false, nicknameError: '', playerIcon: null, wallet: null, walletStatus: 'idle' });
    try {
      const { error } = await this.sdk.signOut({ scope: 'local' }); if (error) throw error;
      await this.acceptSession(null); this.publish({ error: '' });
    } catch { this.publish({ working: false, error: 'Sign-out could not finish. Check your connection and retry.' }); }
  }
  dismissError() { this.publish({ error: '' }); }
  dismissNicknameError() { if (this.state.nicknameStatus === 'ready') this.publish({ nicknameError: '' }); }
}

async function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  return fetch(input, { ...init, signal });
}
let browserController: AuthController | undefined;
export function browserAuth(): AuthController {
  if (browserController) return browserController;
  const overrideUrl = import.meta.env.VITE_SUPABASE_URL?.trim(); const overrideKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const parsed = publicAuthConfigSchema.safeParse(overrideUrl || overrideKey ? { url: overrideUrl, publishableKey: overrideKey } : PUBLIC_SUPABASE_CONFIG);
  const config = parsed.success ? parsed.data : PUBLIC_SUPABASE_CONFIG;
  let sdkPromise: Promise<AuthSdk> | undefined;
  const getSdk = () => sdkPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(config.url, config.publishableKey,
    { auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: parsed.success, autoRefreshToken: parsed.success }, global: { fetch: boundedFetch } }).auth);
  const sdk: AuthSdk = {
    getSession: async () => (await getSdk()).getSession(),
    getUser: async () => (await getSdk()).getUser(),
    updateUser: async input => (await getSdk()).updateUser(input),
    exchangeCodeForSession: async (code, options) => (await getSdk()).exchangeCodeForSession(code, options),
    signInWithOAuth: async input => (await getSdk()).signInWithOAuth(input),
    signOut: async options => (await getSdk()).signOut(options),
    onAuthStateChange(callback) {
      let stopped = false; let subscription: { unsubscribe(): void } | undefined;
      void getSdk().then(client => { if (!stopped) subscription = client.onAuthStateChange(callback).data.subscription; }).catch(() => { /* getSession reports initialization failure. */ });
      return { data: { subscription: { unsubscribe: () => { stopped = true; subscription?.unsubscribe(); } } } };
    },
  };
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  browserController = new AuthController(sdk, {
    url: () => new URL(window.location.href), baseUrl, now: Date.now,
    storage: { getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value), removeItem: key => window.sessionStorage.removeItem(key) },
    replace: url => window.history.replaceState(null, '', url), navigate: url => window.location.assign(url),
    async verify(token, signal) {
      const origin = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
      const response = await boundedFetch(`${origin}/api/v1/account/session`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Account verification unavailable');
      return accountSessionSchema.parse(await response.json());
    },
    async readWallet(token, signal) {
      const origin = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
      const request = (method: string) => boundedFetch(`${origin}/api/v1/account/wallet`, { method, headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
      let response = await request('GET');
      if (response.status === 404 && (await response.clone().json() as { code?: string }).code === 'WALLET_NOT_FOUND') {
        // Provision this verified caller; the database awards the one-time welcome grant. Never import table chips.
        response = await request('POST');
      }
      if (response.status === 503 && (await response.clone().json() as { code?: string }).code === 'WALLET_NOT_CONNECTED') return null;
      if (!response.ok) throw new Error('Wallet unavailable');
      return walletSummarySchema.parse(await response.json());
    },
  }, config.url, parsed.success);
  return browserController;
}

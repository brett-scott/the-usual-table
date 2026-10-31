import { describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_CONFIG, type AccountSession, type WalletSummary } from '@casual/protocol';
import { ACCOUNT_ICON_KEY, ACCOUNT_NICKNAME_KEY, AuthController, authCallback, cleanAuthCallback, safeAuthDestination, type AuthEnvironment, type AuthSdk } from './authClient';

const now = Date.UTC(2026, 9, 31);
const account: AccountSession = { accountId: 'a213ae22-a459-456d-976c-dc115e74abda', provider: 'google', expiresAt: now + 3_600_000 };
const session = { access_token: 'session.access.token', refresh_token: 'refresh', expires_at: account.expiresAt / 1000,
  user: { id: account.accountId } } as Session;
function fixture(path = '/repo/#/games', enabled = true) {
  let address = new URL(path, 'https://site.test'); const stored = new Map<string, string>();
  let event: (event: string, session: Session | null) => void = () => {};
  const sdk = {
    getSession: vi.fn(async () => ({ data: { session: null as Session | null }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: session.user as User | null }, error: null as Error | null })),
    updateUser: vi.fn(async (input: Parameters<AuthSdk['updateUser']>[0]) => ({ data: { user: { ...session.user, user_metadata: input.data } as User | null }, error: null as Error | null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: session as Session | null }, error: null as Error | null })),
    signInWithOAuth: vi.fn(async (input: Parameters<AuthSdk['signInWithOAuth']>[0]): ReturnType<AuthSdk['signInWithOAuth']> => ({ data: {
      url: `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/authorize?provider=${input.provider}`, flowId: 'flow-for-this-tab' }, error: null as Error | null })),
    signOut: vi.fn(async () => ({ error: null as Error | null })),
    onAuthStateChange: vi.fn((callback: typeof event) => { event = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
  } satisfies AuthSdk;
  const env = {
    url: () => new URL(address), baseUrl: 'https://site.test/repo/', now: () => now,
    storage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } },
    replace: vi.fn((url: string) => { address = new URL(url); }), navigate: vi.fn(),
    verify: vi.fn<AuthEnvironment['verify']>(async () => account),
    readWallet: vi.fn<AuthEnvironment['readWallet']>(async () => null),
  } satisfies AuthEnvironment;
  const client = new AuthController(sdk, env, PUBLIC_SUPABASE_CONFIG.url, enabled);
  function intent(hash = '#/games', extras = {}) { stored.set('usual-auth-intent', JSON.stringify({ version: 1, provider: 'google', hash, createdAt: now, ...extras })); }
  return { client, sdk, env, stored, intent, event: (name: string, value: Session | null) => event(name, value) };
}

describe('OAuth return boundaries', () => {
  it('keeps an unexpired verified account during same-account refresh and clears it if verification fails', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null }); await f.client.start();
    let finish!: (value: AccountSession) => void;
    f.env.verify.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.event('TOKEN_REFRESHED', { ...session, access_token: 'new.token' });
    await vi.waitFor(() => expect(f.env.verify).toHaveBeenCalledTimes(2));
    expect(f.client.getSnapshot().account?.accountId).toBe(account.accountId);
    finish({ ...account, expiresAt: account.expiresAt + 1000 }); await vi.waitFor(() => expect(f.client.getSnapshot().working).toBe(false));
    f.env.verify.mockRejectedValueOnce(new Error('Revoked')); f.event('TOKEN_REFRESHED', { ...session, access_token: 'bad.token' });
    await vi.waitFor(() => expect(f.client.getSnapshot().account).toBeNull());
  });
  it('provides a current gameplay token only for the verified account and clears access on sign-out', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null }); await f.client.start();
    expect(await f.client.accessToken()).toBe(session.access_token);
    f.sdk.getSession.mockResolvedValue({ data: { session: { ...session, user: { ...session.user, id: crypto.randomUUID() } } }, error: null });
    await expect(f.client.accessToken()).rejects.toThrow('Sign in again');
    f.sdk.getSession.mockResolvedValue({ data: { session }, error: null }); await f.client.signOut();
    await expect(f.client.accessToken()).rejects.toThrow('Sign in again');
  });
  it('allows only local game/invitation hashes', () => {
    for (const hash of ['#/games', '#/games/blackjack', '#/games/blackjack/lobbies', `#/room/${'a'.repeat(32)}`]) expect(safeAuthDestination(hash)).toBe(hash);
    for (const hash of ['https://evil.test', '//evil.test', '#/games?token=secret', '#/room/short', '#access_token=secret']) expect(safeAuthDestination(hash)).toBe('#/games');
  });
  it('removes codes, flow selectors, OAuth errors and implicit tokens while keeping unrelated parameters', () => {
    const url = new URL('https://site.test/repo/?code=secret&sb_flow_id=flow&error=oops&error_description=secret&keep=yes#access_token=private&refresh_token=private');
    expect(authCallback(url).present).toBe(true);
    expect(cleanAuthCallback(url).href).toBe('https://site.test/repo/?keep=yes');
    expect(authCallback(new URL('https://site.test/repo/#/games')).present).toBe(false);
  });
  it.each(['google', 'discord'] as const)('starts %s with the exact Pages base URL and persists only this tab’s return intent', async provider => {
    const f = fixture(`#/room/${'b'.repeat(32)}`); await f.client.start(); await f.client.signIn(provider);
    expect(f.sdk.signInWithOAuth).toHaveBeenCalledWith({ provider, options: { redirectTo: f.env.baseUrl, skipBrowserRedirect: true } });
    expect(JSON.parse(f.stored.get('usual-auth-intent')!)).toMatchObject({ provider, hash: `#/room/${'b'.repeat(32)}`, flowId: 'flow-for-this-tab' });
    expect([...f.stored.values()].join('')).not.toContain(session.access_token);
    expect(f.env.navigate).toHaveBeenCalledWith(`${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/authorize?provider=${provider}`);
  });
  it('exchanges once, verifies on the API and restores an invitation without losing unrelated saved data', async () => {
    const f = fixture('/repo/?code=one-use-code&sb_flow_id=flow'); f.intent(`#/room/${'b'.repeat(32)}`, { flowId: 'flow' });
    f.stored.set('unrelated-preference', 'keep');
    await Promise.all([f.client.start(), f.client.start()]);
    expect(f.sdk.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('one-use-code', { flowId: 'flow' });
    expect(f.env.verify).toHaveBeenCalledWith(session.access_token, expect.any(AbortSignal));
    expect(f.env.url().href).toBe(`https://site.test/repo/#/room/${'b'.repeat(32)}`);
    expect(f.client.getSnapshot()).toMatchObject({ callbackPending: false, account, working: false });
    expect(f.stored.get('unrelated-preference')).toBe('keep'); expect(f.stored.has('usual-auth-intent')).toBe(false);
  });
  it.each(['missing-intent', 'expired', 'future', 'flow-mismatch', 'duplicate-code', 'cancelled', 'implicit'] as const)('recovers to guest entry after %s without exchanging an invalid code', async mode => {
    const path = mode === 'cancelled' ? '/repo/#error=access_denied&error_description=private' : mode === 'implicit' ? '/repo/#access_token=private' : mode === 'duplicate-code' ? '/repo/?code=one&code=two' : mode === 'flow-mismatch' ? '/repo/?code=one&sb_flow_id=wrong' : '/repo/?code=one';
    const f = fixture(path);
    if (mode !== 'missing-intent') f.intent('#/games/blackjack', { ...(mode === 'expired' ? { createdAt: now - 1_000_000 } : mode === 'future' ? { createdAt: now + 1000 } : {}), flowId: 'correct' });
    await f.client.start();
    expect(f.sdk.exchangeCodeForSession).not.toHaveBeenCalled(); expect(f.env.verify).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ callbackPending: false, account: null, working: false, error: expect.any(String) });
    expect(f.env.url().href).not.toMatch(/private|code=|error=/);
  });
  it('does not leave a callback code in the URL after a failed exchange', async () => {
    const f = fixture('/repo/?code=expired'); f.intent();
    f.sdk.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: new Error('private provider error') });
    await f.client.start(); expect(f.env.url().href).toBe('https://site.test/repo/#/games');
    expect(f.client.getSnapshot().error).not.toContain('private provider error');
  });
  it('rejects an unexpected authorization host and overlapping sign-in attempts', async () => {
    const f = fixture(); await f.client.start();
    f.sdk.signInWithOAuth.mockResolvedValue({ data: { url: 'https://evil.test/?provider=google', flowId: 'flow' }, error: null });
    await Promise.all([f.client.signIn('google'), f.client.signIn('discord')]);
    expect(f.sdk.signInWithOAuth).toHaveBeenCalledTimes(1); expect(f.env.navigate).not.toHaveBeenCalled();
    expect(f.stored.has('usual-auth-intent')).toBe(false);
  });
  it('keeps guest entry usable if browser storage is blocked or configuration is unavailable', async () => {
    const f = fixture(); await f.client.start(); f.env.storage.setItem = () => { throw new Error('Storage blocked'); };
    await f.client.signIn('google'); expect(f.sdk.signInWithOAuth).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ callbackPending: false, working: false, account: null });
    const disabled = fixture('/repo/#/games', false); await disabled.client.start(); await disabled.client.signIn('google');
    expect(disabled.sdk.getSession).not.toHaveBeenCalled(); expect(disabled.sdk.signInWithOAuth).not.toHaveBeenCalled();
  });
  it('does not navigate after a guest cancels a pending provider start', async () => {
    const f = fixture(); await f.client.start(); let resolve!: (value: Awaited<ReturnType<AuthSdk['signInWithOAuth']>>) => void;
    f.sdk.signInWithOAuth.mockImplementation(() => new Promise(done => { resolve = done; }));
    const signingIn = f.client.signIn('google'); f.client.cancelSignIn();
    resolve({ data: { url: `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/authorize?provider=google` }, error: null }); await signingIn;
    expect(f.env.navigate).not.toHaveBeenCalled(); expect(f.stored.has('usual-auth-intent')).toBe(false);
    expect(f.client.getSnapshot().working).toBe(false);
  });
});

describe('verified account lifecycle', () => {
  it('verifies restored sessions rather than trusting their saved user metadata', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    await f.client.start(); expect(f.client.getSnapshot().account).toEqual(account);
    expect(f.env.verify).toHaveBeenCalledTimes(1);
  });
  it('shows no connected account if the API rejects it or its identity differs', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.env.verify.mockResolvedValue({ ...account, accountId: crypto.randomUUID() });
    await f.client.start(); expect(f.client.getSnapshot()).toMatchObject({ account: null, hasSession: true, working: false });
    f.env.verify.mockRejectedValue(new Error('API unavailable')); await f.client.retry();
    expect(f.client.getSnapshot().account).toBeNull();
  });
  it('ignores a late verification reply after local sign-out', async () => {
    const f = fixture(); let resolve!: (value: AccountSession) => void;
    f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.env.verify.mockImplementation(() => new Promise<AccountSession>(done => { resolve = done; }));
    const starting = f.client.start(); await vi.waitFor(() => expect(f.env.verify).toHaveBeenCalled());
    await f.client.signOut(); resolve(account); await starting;
    expect(f.client.getSnapshot()).toMatchObject({ account: null, hasSession: false, working: false });
    expect(f.sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('re-verifies refreshed tokens and clears the public account on a signed-out event', async () => {
    const f = fixture(); await f.client.start(); f.event('TOKEN_REFRESHED', session);
    await vi.waitFor(() => expect(f.client.getSnapshot().account).toEqual(account));
    f.event('SIGNED_OUT', null); await vi.waitFor(() => expect(f.client.getSnapshot().account).toBeNull());
    expect(f.client.getSnapshot().hasSession).toBe(false);
  });
});

describe('account nicknames', () => {
  async function connected(nickname?: string) {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.sdk.getUser.mockResolvedValue({ data: { user: { ...session.user, user_metadata: { [ACCOUNT_NICKNAME_KEY]: nickname } } }, error: null });
    await f.client.start(); return f;
  }
  it('requires a chosen nickname instead of importing provider display names', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.sdk.getUser.mockResolvedValue({ data: { user: { ...session.user, user_metadata: { full_name: 'Private Google name', username: 'Discord handle' } } }, error: null });
    await f.client.start(); expect(f.client.getSnapshot()).toMatchObject({ account, nickname: null, nicknameStatus: 'ready' });
    expect(f.sdk.updateUser).not.toHaveBeenCalled();
  });
  it('loads the saved nickname from Auth rather than stale session metadata', async () => {
    const f = await connected('Alex');
    expect(f.client.getSnapshot()).toMatchObject({ account, nickname: 'Alex', nicknameStatus: 'ready' });
    expect(f.sdk.getUser).toHaveBeenCalledTimes(1);
  });
  it('trims and persists only nickname display metadata, keeping the verified UUID', async () => {
    const f = await connected(); expect(await f.client.saveNickname('  River  ')).toBe(true);
    expect(f.sdk.updateUser).toHaveBeenCalledExactlyOnceWith({ data: { [ACCOUNT_NICKNAME_KEY]: 'River', [ACCOUNT_ICON_KEY]: null } });
    expect(f.client.getSnapshot()).toMatchObject({ account, nickname: 'River', savingNickname: false });
    expect([...f.stored.values()].join('')).not.toContain('River');
  });
  it('allows two distinct accounts to choose the same nickname and permits renames', async () => {
    const first = await connected('Before'); const second = fixture();
    const other = { ...account, accountId: crypto.randomUUID() }; const otherUser = { ...session.user, id: other.accountId };
    second.sdk.getSession.mockResolvedValue({ data: { session: { ...session, user: otherUser } }, error: null });
    second.sdk.getUser.mockResolvedValue({ data: { user: otherUser }, error: null }); second.env.verify.mockResolvedValue(other);
    second.sdk.updateUser.mockImplementation(async input => ({ data: { user: { ...otherUser, user_metadata: input.data } }, error: null }));
    await second.client.start();
    expect(await first.client.saveNickname('Alex')).toBe(true); expect(await second.client.saveNickname('Alex')).toBe(true);
    expect(first.client.getSnapshot().account?.accountId).not.toBe(second.client.getSnapshot().account?.accountId);
    expect(await first.client.saveNickname('River')).toBe(true); expect(first.client.getSnapshot().account).toEqual(account);
  });
  it.each(['', '   ', 'x'.repeat(25)])('rejects an invalid nickname %j before sending a mutation', async name => {
    const f = await connected('Alex'); expect(await f.client.saveNickname(name)).toBe(false);
    expect(f.sdk.updateUser).not.toHaveBeenCalled(); expect(f.client.getSnapshot().nickname).toBe('Alex');
  });
  it('retains the old nickname on a failed save and allows retry', async () => {
    const f = await connected('Alex'); f.sdk.updateUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('private backend error') });
    expect(await f.client.saveNickname('River')).toBe(false);
    expect(f.client.getSnapshot()).toMatchObject({ nickname: 'Alex', savingNickname: false });
    expect(f.client.getSnapshot().nicknameError).not.toContain('private backend error');
    expect(await f.client.saveNickname('River')).toBe(true);
  });
  it('distinguishes unavailable nickname storage from a first login and rejects a mismatched profile', async () => {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.sdk.getUser.mockRejectedValueOnce(new Error('offline')); await f.client.start();
    expect(f.client.getSnapshot()).toMatchObject({ account, nicknameStatus: 'error' });
    expect(await f.client.saveNickname('Overwrite')).toBe(false); expect(f.sdk.updateUser).not.toHaveBeenCalled();
    f.sdk.getUser.mockResolvedValueOnce({ data: { user: { ...session.user, id: crypto.randomUUID() } }, error: null });
    await f.client.retry(); expect(f.client.getSnapshot().nicknameStatus).toBe('error');
    await f.client.retry(); expect(f.client.getSnapshot().nicknameStatus).toBe('ready');
  });
  it('does not load or save a nickname without a verified account', async () => {
    const f = fixture(); await f.client.start(); expect(await f.client.saveNickname('Alex')).toBe(false);
    expect(f.sdk.getUser).not.toHaveBeenCalled(); expect(f.sdk.updateUser).not.toHaveBeenCalled();
    f.sdk.getSession.mockResolvedValue({ data: { session }, error: null }); f.env.verify.mockRejectedValue(new Error('invalid'));
    await f.client.retry(); expect(f.sdk.getUser).not.toHaveBeenCalled();
  });
  it('ignores late nickname loads and saves after sign-out and prevents overlapping saves', async () => {
    const f = await connected('Alex'); let resolve!: (value: Awaited<ReturnType<AuthSdk['updateUser']>>) => void;
    f.sdk.updateUser.mockImplementation(() => new Promise(done => { resolve = done; }));
    const saving = f.client.saveNickname('River'); expect(await f.client.saveNickname('Other')).toBe(false);
    await f.client.signOut(); resolve({ data: { user: { ...session.user, user_metadata: { [ACCOUNT_NICKNAME_KEY]: 'River' } } }, error: null });
    expect(await saving).toBe(false); expect(f.client.getSnapshot()).toMatchObject({ account: null, nickname: null, savingNickname: false });
    const loading = fixture(); let loaded!: (value: Awaited<ReturnType<AuthSdk['getUser']>>) => void;
    loading.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    loading.sdk.getUser.mockImplementation(() => new Promise(done => { loaded = done; }));
    const starting = loading.client.start(); await vi.waitFor(() => expect(loading.sdk.getUser).toHaveBeenCalled());
    await loading.client.signOut(); loaded({ data: { user: session.user }, error: null }); await starting;
    expect(loading.client.getSnapshot()).toMatchObject({ account: null, nickname: null, nicknameStatus: 'idle' });
  });
  it('handles SDK user-update events without reentering account verification during a nickname save', async () => {
    const f = await connected('Alex');
    f.sdk.updateUser.mockImplementation(async input => {
      const user = { ...session.user, user_metadata: input.data }; f.event('USER_UPDATED', { ...session, user });
      return { data: { user }, error: null };
    });
    expect(await f.client.saveNickname('River')).toBe(true);
    await vi.waitFor(() => expect(f.client.getSnapshot().nickname).toBe('River'));
    expect(f.env.verify).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot().account).toEqual(account);
    f.event('USER_UPDATED', { ...session, user: { ...session.user, user_metadata: { [ACCOUNT_NICKNAME_KEY]: 'Another device' } } });
    await vi.waitFor(() => expect(f.client.getSnapshot().nickname).toBe('Another device'));
  });
});

describe('profile icons and saved wallet reads', () => {
  const wallet: WalletSummary = { contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId: account.accountId,
    status: 'active', version: 3, availableUnits: 123456, atTablesUnits: 25000, pendingReturnUnits: 5050 };
  async function connected(icon: unknown = '🦊') {
    const f = fixture(); f.sdk.getSession.mockResolvedValue({ data: { session }, error: null });
    f.sdk.getUser.mockResolvedValue({ data: { user: { ...session.user, user_metadata: { [ACCOUNT_NICKNAME_KEY]: 'Alex', [ACCOUNT_ICON_KEY]: icon, balance: 999999999 } } }, error: null });
    await f.client.start(); return f;
  }
  it('loads the account icon and preserves it when only the nickname changes', async () => {
    const f = await connected(); expect(f.client.getSnapshot().playerIcon).toBe('🦊');
    expect(await f.client.saveNickname('River')).toBe(true);
    expect(f.sdk.updateUser).toHaveBeenCalledExactlyOnceWith({ data: { [ACCOUNT_NICKNAME_KEY]: 'River', [ACCOUNT_ICON_KEY]: '🦊' } });
    expect(f.client.getSnapshot()).toMatchObject({ nickname: 'River', playerIcon: '🦊', wallet: null });
  });
  it('persists a changed icon and explicitly clears it to the player initial', async () => {
    const f = await connected(); expect(await f.client.saveNickname('Alex', '🐱')).toBe(true);
    expect(f.client.getSnapshot().playerIcon).toBe('🐱'); expect(await f.client.saveNickname('Alex', null)).toBe(true);
    expect(f.sdk.updateUser).toHaveBeenLastCalledWith({ data: { [ACCOUNT_NICKNAME_KEY]: 'Alex', [ACCOUNT_ICON_KEY]: null } });
    expect(f.client.getSnapshot().playerIcon).toBeNull(); expect(f.client.getSnapshot().account).toEqual(account);
  });
  it('rejects unsupported icons and safely falls back when saved display metadata is invalid', async () => {
    const f = await connected('<img src=x>'); expect(f.client.getSnapshot().playerIcon).toBeNull();
    expect(await f.client.saveNickname('Alex', 'not-an-icon' as never)).toBe(false); expect(f.sdk.updateUser).not.toHaveBeenCalled();
  });
  it('keeps both saved display choices when a profile update fails', async () => {
    const f = await connected(); f.sdk.updateUser.mockRejectedValue(new Error('offline'));
    expect(await f.client.saveNickname('River', '🐱')).toBe(false);
    expect(f.client.getSnapshot()).toMatchObject({ nickname: 'Alex', playerIcon: '🦊', savingNickname: false });
  });
  it('reads the verified account wallet separately from editable metadata and does not store tokens', async () => {
    const f = await connected(); expect(f.env.readWallet).not.toHaveBeenCalled();
    f.env.readWallet.mockResolvedValue(wallet); await f.client.refreshWallet();
    expect(f.env.readWallet).toHaveBeenCalledExactlyOnceWith(session.access_token, expect.any(AbortSignal));
    expect(f.client.getSnapshot()).toMatchObject({ wallet, walletStatus: 'ready' });
    expect([...f.stored.values()].join('')).not.toContain(session.access_token);
  });
  it('never reads an account wallet for guests or unverified sessions', async () => {
    const f = fixture(); await f.client.start(); await f.client.refreshWallet(); expect(f.env.readWallet).not.toHaveBeenCalled();
    f.sdk.getSession.mockResolvedValue({ data: { session }, error: null }); f.env.verify.mockRejectedValue(new Error('invalid'));
    await f.client.retry(); await f.client.refreshWallet(); expect(f.env.readWallet).not.toHaveBeenCalled();
  });
  it.each([
    { ...wallet, accountId: crypto.randomUUID() }, { ...wallet, availableUnits: -1 }, { ...wallet, unitsPerChip: 2 },
  ])('rejects wrong-account or malformed wallet data', async invalid => {
    const f = await connected(); f.env.readWallet.mockResolvedValue(invalid as WalletSummary); await f.client.refreshWallet();
    expect(f.client.getSnapshot()).toMatchObject({ wallet: null, walletStatus: 'error' });
  });
  it('distinguishes an unconfigured service and read failures from a real zero balance', async () => {
    const f = await connected(); await f.client.refreshWallet(); expect(f.client.getSnapshot()).toMatchObject({ wallet: null, walletStatus: 'not-connected' });
    f.env.readWallet.mockResolvedValue({ ...wallet, availableUnits: 0 }); await f.client.refreshWallet();
    expect(f.client.getSnapshot()).toMatchObject({ walletStatus: 'ready', wallet: { availableUnits: 0 } });
    f.env.readWallet.mockRejectedValue(new Error('offline')); await f.client.refreshWallet();
    expect(f.client.getSnapshot()).toMatchObject({ wallet: null, walletStatus: 'error' });
    f.env.readWallet.mockResolvedValue(wallet); await f.client.refreshWallet(); expect(f.client.getSnapshot().wallet).toEqual(wallet);
  });
  it('ignores an outstanding wallet read after sign-out, aborts it and refuses duplicate reads', async () => {
    const f = await connected(); let resolve!: (result: WalletSummary) => void;
    f.env.readWallet.mockImplementation(() => new Promise(done => { resolve = done; }));
    const reading = f.client.refreshWallet(); await vi.waitFor(() => expect(f.env.readWallet).toHaveBeenCalled());
    await f.client.refreshWallet(); expect(f.env.readWallet).toHaveBeenCalledTimes(1);
    const signal = f.env.readWallet.mock.calls[0]![1]; await f.client.signOut(); expect(signal.aborted).toBe(true);
    resolve(wallet); await reading; expect(f.client.getSnapshot()).toMatchObject({ account: null, playerIcon: null, wallet: null, walletStatus: 'idle' });
  });
});

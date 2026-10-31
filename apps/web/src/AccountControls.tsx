import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PLAYER_ICONS, WALLET_UNITS_PER_CHIP, type PlayerIcon } from '@casual/protocol';
import { browserAuth, type AuthController, type AuthState } from './authClient';
import s from './AccountControls.module.css';

type ProfileEdit = 'nickname' | 'icon' | null;
const AuthContext = createContext<{ auth: AuthController; editNickname(): void; editIcon(): void } | null>(null);
export function useAccountState(): AuthState {
  const { auth } = useContext(AuthContext)!;
  return useSyncExternalStore(auth.subscribe, auth.getSnapshot);
}
export function AccountProvider({ children }: { children: ReactNode }) {
  const [auth] = useState(browserAuth);
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  const [editing, setEditing] = useState<ProfileEdit>(null);
  useEffect(() => { void auth.start(); }, [auth]);
  return <AuthContext.Provider value={{ auth,
    editNickname: () => { auth.dismissNicknameError(); setEditing('nickname'); },
    editIcon: () => { auth.dismissNicknameError(); setEditing('icon'); } }}>{state.callbackPending
    ? <main className={s.callback} role="status"><h1>Welcome back.</h1><p>Finishing your sign-in…</p></main> : children}
    <NicknameDialog auth={auth} state={state} editing={editing} onClose={() => setEditing(null)} />
  </AuthContext.Provider>;
}

function NicknameDialog({ auth, state, editing, onClose }: { auth: AuthController; state: AuthState; editing: ProfileEdit; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  const required = !!state.account && state.nicknameStatus === 'ready' && !state.nickname;
  const open = !!state.account && (required || editing || state.nicknameStatus === 'error');
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLElement>(editing === 'icon' ? 'select' : 'input')?.focus();
    }
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open, editing]);
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={titleId}
    onCancel={event => { if (required || state.savingNickname) event.preventDefault(); }} onClose={onClose}>
    {open && <>
      <div className={s.heading}><h2 id={titleId}>{required ? 'Choose your nickname' : state.nicknameStatus === 'error' ? 'Your profile' : editing === 'icon' ? 'Edit profile' : 'Edit nickname'}</h2>
        {!required && <button type="button" disabled={state.savingNickname} aria-label="Close nickname" onClick={() => dialog.current?.close()}>×</button>}
      </div>
      {state.nicknameStatus === 'error' ? <>
        <p className={s.error} role="alert">{state.nicknameError}</p>
        <button disabled={state.working} onClick={() => { void auth.retry(); }}>Retry loading profile</button>
      </> : <NicknameForm auth={auth} state={state} required={required} focusIcon={editing === 'icon'} onSaved={() => dialog.current?.close()} />}
      {required || state.nicknameStatus === 'error'
        ? <button className={s.guest} disabled={state.savingNickname || state.working} onClick={() => { void auth.signOut(); }}>Sign out</button>
        : <button className={s.guest} disabled={state.savingNickname} onClick={() => dialog.current?.close()}>Cancel</button>}
    </>}
  </dialog>;
}
function NicknameForm({ auth, state, required, focusIcon, onSaved }: { auth: AuthController; state: AuthState; required: boolean; focusIcon: boolean; onSaved(): void }) {
  const inputId = useId(); const [draft, setDraft] = useState(state.nickname ?? '');
  const [icon, setIcon] = useState<PlayerIcon | ''>(state.playerIcon ?? '');
  return <form className={s.nicknameForm} onSubmit={event => { event.preventDefault(); void auth.saveNickname(draft, icon || null).then(saved => { if (saved) onSaved(); }); }}>
    <p>{required ? 'What should we call you at the table?' : 'Your nickname and icon will appear when you take your next seat.'}</p>
    <label htmlFor={inputId}>Nickname</label>
    <input id={inputId} name="nickname" autoComplete="nickname" autoFocus={!focusIcon} required maxLength={24} value={draft}
      onChange={event => { setDraft(event.target.value); auth.dismissNicknameError(); }} disabled={state.savingNickname} aria-describedby={`${inputId}-hint`} />
    <p className={s.note} id={`${inputId}-hint`}>1–24 characters. Other players can use the same nickname.</p>
    <label htmlFor={`${inputId}-icon`}>Player icon <small>(optional)</small></label>
    <select id={`${inputId}-icon`} autoFocus={focusIcon} value={icon} disabled={state.savingNickname}
      onChange={event => { setIcon(event.target.value as PlayerIcon | ''); auth.dismissNicknameError(); }}>
      <option value="">Use my initial</option>{PLAYER_ICONS.map(choice => <option key={choice.emoji} value={choice.emoji}>{choice.emoji} {choice.label}</option>)}
    </select>
    {state.nicknameError && <p className={s.error} role="alert">{state.nicknameError}</p>}
    <button type="submit" disabled={state.savingNickname}>{state.savingNickname ? 'Saving…' : focusIcon ? 'Save profile' : 'Save nickname'}</button>
  </form>;
}

export function AccountControls({ beforeSignIn, signedInOnly = false }: { beforeSignIn?: () => void; signedInOnly?: boolean }) {
  const { auth, editNickname, editIcon } = useContext(AuthContext)!;
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const controls = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null); const titleId = useId(); const menuId = useId(); const [expanded, setExpanded] = useState(false);
  const focusLast = useRef(false);
  useEffect(() => { if (state.account) dialog.current?.close(); else setExpanded(false); }, [state.account]);
  useEffect(() => { if (expanded) void auth.refreshWallet(); }, [expanded, auth]);
  useEffect(() => {
    if (!expanded) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    buttons?.[focusLast.current ? buttons.length - 1 : 0]?.focus();
    const outside = (event: Event) => { if (!controls.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [expanded]);
  function closeMenu() { setExpanded(false); trigger.current?.focus(); }
  if (signedInOnly && !state.hasSession) return null;
  return <div className={`${s.controls} ${signedInOnly ? s.compact : ''}`} ref={controls}
    onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); closeMenu(); } }}>
    <button className={s.trigger} ref={trigger} aria-haspopup={state.account ? 'menu' : 'dialog'} aria-expanded={state.account ? expanded : undefined}
      aria-controls={state.account && expanded ? menuId : undefined} aria-label={state.account ? `Account menu for ${state.nickname ?? 'your account'}` : undefined}
      onClick={() => { focusLast.current = false; if (state.account) setExpanded(value => !value); else dialog.current?.showModal(); }}
      onKeyDown={event => { if (state.account && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setExpanded(true); } }}>
      {state.account && <span className={s.profileIcon}>{state.playerIcon ?? state.nickname?.slice(0, 1).toUpperCase() ?? '♣'}</span>}
      <span className={s.nickname}>{state.account ? state.nickname ?? 'Your account' : 'Sign in'}</span>{state.account && <span aria-hidden="true"> ▾</span>}
    </button>
    {state.account && expanded && <div className={s.menu} ref={menu} id={menuId} role="menu" aria-label="Account" onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
      <button role="menuitem" onClick={() => { closeMenu(); editNickname(); }}>Edit nickname</button>
      <button role="menuitem" onClick={() => { closeMenu(); editIcon(); }}>Edit player icon</button>
      <button role="menuitem" disabled={state.working || state.savingNickname} onClick={() => { closeMenu(); void auth.signOut(); }}>Sign out</button>
      <div className={s.wallet} role="group" aria-label="Account wallet" aria-live="polite">
        <span>Wallet balance</span>
        {state.walletStatus === 'ready' && state.wallet ? <>
          <strong>{chips(state.wallet.availableUnits)} <small>chips available</small></strong>
          <dl><div><dt>At tables</dt><dd>{chips(state.wallet.atTablesUnits)}</dd></div><div><dt>Returning</dt><dd>{chips(state.wallet.pendingReturnUnits)}</dd></div></dl>
          {state.wallet.status === 'suspended' && <p>Wallet paused</p>}
        </> : <><strong>{state.walletStatus === 'loading' || state.walletStatus === 'idle' ? 'Loading…' : state.walletStatus === 'not-connected' ? 'Not connected yet' : 'Unavailable'}</strong>
          {state.walletStatus === 'error' && <button role="menuitem" onClick={() => {
            // Keep keyboard focus in the menu when this retry button disappears after a successful read.
            menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); void auth.refreshWallet();
          }}>Retry wallet balance</button>}</>}
      </div>
      <p className={s.note}>Temporary table chips · Separate from your wallet</p>
    </div>}
    {state.error && <span className={s.notice} role="status">Account unavailable · Guest play is available</span>}
    <dialog ref={dialog} className={s.dialog} aria-labelledby={titleId} onClose={() => { auth.cancelSignIn(); trigger.current?.focus(); }}>
      <div className={s.heading}><h2 id={titleId}>A seat with your name on it.</h2><button autoFocus aria-label="Close account" onClick={() => dialog.current?.close()}>×</button></div>
      <p>Sign in with Google or Discord, or keep playing as a guest.</p>
      <p className={s.note}>Tables currently use temporary chips. Playing with your saved chips and saving progress are coming soon.</p>
      {state.error && <p className={s.error} role="alert">{state.error}</p>}
      <div className={s.providers}>
        <button disabled={state.working} onClick={() => { beforeSignIn?.(); void auth.signIn('google'); }}>Continue with Google</button>
        <button disabled={state.working} onClick={() => { beforeSignIn?.(); void auth.signIn('discord'); }}>Continue with Discord</button>
      </div>
      {state.hasSession && <button disabled={state.working} onClick={() => { void auth.retry(); }}>Retry account connection</button>}
      {state.hasSession && <button disabled={state.working} onClick={() => { void auth.signOut(); }}>Sign out</button>}
      {state.working && <p role="status">Connecting your account…</p>}
      <button className={s.guest} onClick={() => { auth.dismissError(); dialog.current?.close(); }}>Continue as guest</button>
    </dialog>
  </div>;
}

function chips(units: number) { return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(units / WALLET_UNITS_PER_CHIP); }


import { useEffect, useId, type FormEvent, type RefObject } from 'react';
import { PLAYER_ICONS, type LobbyVisibility, type PlayerIcon } from '@casual/protocol';
import { useAccountState } from './AccountControls';
import { browserAuth } from './authClient';
import { PlayerAvatar } from './PlayerAvatar';
import type { useTableFunding, useTableIdentity } from './TableIdentity';
import s from './CreateTableDialog.module.css';

type Props = {
  gameName?:string;
  dialogRef: RefObject<HTMLDialogElement | null>;
  identity: ReturnType<typeof useTableIdentity>;
  funding: ReturnType<typeof useTableFunding>;
  busy: boolean;
  error: string;
  visibility: LobbyVisibility;
  onVisibilityChange(value: LobbyVisibility): void;
  onSubmit(event: FormEvent): void;
  onClose(): void;
};

export function CreateTableDialog({ gameName='Blackjack',dialogRef, identity, funding, busy, error, visibility, onVisibilityChange, onSubmit, onClose }: Props) {
  const account = useAccountState(); const id = useId();
  useEffect(() => { if (account.account) void browserAuth().refreshWallet(); }, [account.account?.accountId]);
  const available = account.walletStatus === 'ready' && account.wallet
    ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(account.wallet.availableUnits / 100) : null;
  const insufficient = funding.saved && account.walletStatus === 'ready' && account.wallet && funding.units > account.wallet.availableUnits;
  const belowMinimum = account.walletStatus === 'ready' && account.wallet && account.wallet.availableUnits < funding.rules.minBuyInUnits;
  const invalid = funding.saved && !funding.valid;
  const profileLoading = account.nicknameStatus === 'idle' || account.nicknameStatus === 'loading';
  const close = () => dialogRef.current?.close();
  return <dialog ref={dialogRef} className={s.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
    onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <header className={s.header}>
      <div><p className={s.eyebrow}><span aria-hidden="true">♣</span> {gameName.toUpperCase()} <span className={s.headerDetail}>· {funding.rules.minPlayers}–{funding.rules.capacity} PLAYERS</span></p>
        <h2 id={`${id}-title`}>Create a table</h2>
        <p className={s.intro} id={`${id}-intro`}>{gameName==='Blackjack'?'A quiet hand for yourself, or a table for your friends.':'Create a table and invite your friends.'}</p></div>
      <button className={s.close} type="button" aria-label="Close create table" disabled={busy} onClick={close}>×</button>
    </header>
    <form className={s.form} onSubmit={onSubmit} aria-busy={busy}>
      <div className={s.body} data-signed-in={identity.signedIn}>
        <section className={s.tableSection} aria-labelledby={`${id}-table-title`}>
          <h3 id={`${id}-table-title`}>Your table</h3>
          <label htmlFor={`${id}-visibility`}>Table visibility</label>
          <select id={`${id}-visibility`} value={visibility} disabled={busy} onChange={event => onVisibilityChange(event.target.value as LobbyVisibility)} aria-describedby={`${id}-visibility-help`}>
            <option value="private">Private · Invite only</option><option value="public">Public · Listed</option>
          </select>
          <p className={s.hint} id={`${id}-visibility-help`}>{visibility === 'private' ? 'Only people with your invitation link can join.' : 'Listed in public tables. Anyone can join an open seat.'}</p>
        </section>
        <section className={s.seatSection} aria-labelledby={`${id}-seat-title`}>
          <h3 id={`${id}-seat-title`}>Your seat</h3>
          {identity.signedIn ? <div className={s.profile}>
            <PlayerAvatar player={{ name: account.nickname ?? '', icon: account.playerIcon ?? undefined }} />
            <div><strong>{account.nickname ?? (profileLoading ? 'Loading your profile…' : 'Finish your profile')}</strong>
              <span role={identity.ready ? undefined : 'status'}>{identity.ready ? 'Using your saved profile' : profileLoading ? 'Your saved nickname is loading. Please wait.' : account.nicknameStatus === 'error' ? 'Your profile couldn’t be loaded. Return to your profile to retry.' : 'Set your nickname before creating a table.'}</span>
              {!identity.ready && !profileLoading && <button className={s.profileAction} type="button" disabled={busy} onClick={close}>Return to your profile</button>}
            </div>
          </div> : <div className={s.guestFields}>
            <div><label htmlFor={`${id}-name`}>What should we call you?</label>
              <input id={`${id}-name`} autoComplete="nickname" maxLength={24} required value={identity.name} onChange={event => identity.setName(event.target.value)} placeholder="Your display name" disabled={busy} /></div>
            <div><label htmlFor={`${id}-icon`}>Player icon <small>(optional)</small></label>
              <select id={`${id}-icon`} value={identity.icon} onChange={event => identity.setIcon(event.target.value as PlayerIcon | '')} disabled={busy}>
                <option value="">Use my initial</option>{PLAYER_ICONS.map(choice => <option key={choice.emoji} value={choice.emoji}>{choice.emoji} {choice.label}</option>)}</select></div>
          </div>}
        </section>
        <section className={s.chipsSection} role="group" aria-label="Table chips">
          <h3>Your chips</h3>
          {identity.signedIn&&funding.rules.accountFunding==='house' && <div className={s.fundingFields}>
            <div><label htmlFor={`${id}-funding`}>Play with</label>
              <select id={`${id}-funding`} value={funding.mode} disabled={busy} onChange={event => funding.setMode(event.target.value)} aria-describedby={`${id}-chips-help`}>
                <option value="account">Saved account chips</option><option value="guest">Temporary chips</option>
              </select></div>
            {funding.saved && <div><label htmlFor={`${id}-buy-in`}>Buy-in (chips)</label>
              <input id={`${id}-buy-in`} type="number" min={funding.rules.minBuyInUnits/100} step={funding.rules.buyInStepUnits/100} value={funding.amount} disabled={busy} onChange={event => funding.setAmount(event.target.value)} required
                aria-invalid={invalid || undefined} aria-describedby={`${id}-wallet ${id}-chips-help${invalid ? ` ${id}-amount-error` : ''}`} /></div>}
          </div>}
          {funding.saved ? <>
            <div className={s.wallet} id={`${id}-wallet`} role="status" aria-live="polite">
              <div><span>Wallet balance</span><strong>{available !== null ? `${available} chips available` : account.walletStatus === 'error' ? 'Unavailable' : account.walletStatus === 'not-connected' ? 'Not connected yet' : 'Loading wallet balance…'}</strong></div>
              {['error', 'not-connected'].includes(account.walletStatus) && <button className={s.retry} type="button" disabled={busy} onClick={() => { void browserAuth().refreshWallet(); }}>Retry wallet balance</button>}
            </div>
            <p className={s.hint} id={`${id}-chips-help`}>Bring chips from your wallet. Remaining table chips return when you leave.</p>
            {invalid && <p className={s.fieldError} id={`${id}-amount-error`} role="alert">{insufficient ? belowMinimum ? 'Not enough saved chips. Choose temporary chips to play.' : 'Choose a buy-in no larger than your available chips.' : `Enter at least ${funding.rules.minBuyInUnits/100} chips, in steps of ${funding.rules.buyInStepUnits/100}.`}</p>}
          </> : <div className={s.temporary} id={`${id}-chips-help`}>
            <span className={s.chip} aria-hidden="true">♣</span><div><strong>{new Intl.NumberFormat('en').format(funding.rules.guestStartingChips)} temporary chips</strong><p>Chips and results aren’t saved.</p></div>
          </div>}
          {error && <p className={s.error} role="alert">{error}</p>}
        </section>
      </div>
      <footer className={s.footer}>
        <span className={s.playNote}>Play chips. No cash value.</span>
        <button className={s.cancel} type="button" disabled={busy} onClick={close}>Cancel</button>
        <button className={s.create} type="submit" disabled={busy || !identity.ready || !funding.valid}>{busy ? 'Creating…' : 'Create table'}<span aria-hidden="true">↗</span></button>
      </footer>
    </form>
  </dialog>;
}

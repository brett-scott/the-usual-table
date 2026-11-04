import { useEffect, useId, useRef, useState } from 'react';
import { BLACKJACK_TABLE_RULES,displayNameSchema, PLAYER_ICONS, playerIconSchema,type GameEntryRules, type PlayerIcon } from '@casual/protocol';
import { useAccountState } from './AccountControls';
import s from './App.module.css';
import { browserAuth } from './authClient';

function saved(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
export function useTableIdentity() {
  const account = useAccountState();
  const [name, setName] = useState(() => saved('casual-name'));
  const [icon, setIcon] = useState<PlayerIcon | ''>(() => playerIconSchema.safeParse(saved('casual-player-icon')).data ?? '');
  return {
    name, setName, icon, setIcon, signedIn: !!account.account, accountId: account.account?.accountId,
    ready: !account.account || account.nicknameStatus === 'ready' && !!account.nickname,
    validate() {
      const parsed = displayNameSchema.safeParse(account.account ? account.nickname : name);
      return parsed.success ? { name: parsed.data, icon: account.account ? account.playerIcon ?? undefined : icon || undefined } : null;
    },
    saveDraft() {
      if (account.account) return;
      try { localStorage.setItem('casual-name', name); localStorage.setItem('casual-player-icon', icon); } catch { /* Guests can play without saved preferences. */ }
    },
  };
}
export function useTableFunding(rules:GameEntryRules=BLACKJACK_TABLE_RULES) {
  const account = useAccountState();
  const [mode, setMode] = useState('account'); const [amount, setAmount] = useState('1000');
  const entry = useRef(crypto.randomUUID());
  const units = Number(amount) * 100;
  const saved = !!account.account && mode === 'account'&&rules.accountFunding==='house';
  const valid = !saved || amount.trim() !== '' && Number.isSafeInteger(units) && units >= rules.minBuyInUnits && units % rules.buyInStepUnits === 0 && units <= 9_000_000_000_000
    && (account.walletStatus !== 'ready' || !account.wallet || units <= account.wallet.availableUnits);
  return { saved, mode, amount, units, valid, rules,entryId: entry.current,
    setMode(value: string) { setMode(value); entry.current = crypto.randomUUID(); },
    setAmount(value: string) { setAmount(value); entry.current = crypto.randomUUID(); } };
}
export function BuyInFields({ funding, disabled }: { funding: ReturnType<typeof useTableFunding>; disabled: boolean }) {
  const account = useAccountState(); const id = useId();
  useEffect(() => { if (account.account) void browserAuth().refreshWallet(); }, [account.account?.accountId]);
  if (!account.account||funding.rules.accountFunding==='temporary-only') return null;
  const available = account.walletStatus === 'ready' && account.wallet ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(account.wallet.availableUnits / 100) : null;
  return <div className={`${s.iconPicker} ${s.buyInFields}`}>
    <label htmlFor={`${id}-funding`}>Play with</label><select id={`${id}-funding`} value={funding.mode} disabled={disabled} onChange={event => funding.setMode(event.target.value)}>
      <option value="account">Saved account chips</option><option value="guest">Temporary chips</option>
    </select>
    {funding.saved && <><label htmlFor={`${id}-buy-in`}>Buy-in (chips)</label><input id={`${id}-buy-in`} type="number" min={funding.rules.minBuyInUnits/100} step={funding.rules.buyInStepUnits/100} value={funding.amount} disabled={disabled} onChange={event => funding.setAmount(event.target.value)} required />
      <p className={s.smallNote}>{available === null ? 'Your saved wallet will be checked before taking a buy-in.' : `${available} chips available in your wallet.`} Remaining table chips return to your wallet when you leave.</p></>}
    {funding.saved && account.walletStatus === 'ready' && account.wallet && funding.units > account.wallet.availableUnits && <p role="alert">Choose a buy-in no larger than your available chips.</p>}
    {!funding.saved && <p className={s.smallNote}>Temporary chips and results are not saved to your account.</p>}
  </div>;
}
export function GuestIdentityFields({ identity, disabled }: { identity: ReturnType<typeof useTableIdentity>; disabled: boolean }) {
  const id = useId();
  if (identity.signedIn) return null;
  return <>
    <label htmlFor={`${id}-name`}>What should we call you?</label>
    <input id={`${id}-name`} autoComplete="nickname" maxLength={24} required value={identity.name} onChange={event => identity.setName(event.target.value)} placeholder="Your display name" disabled={disabled} />
    <div className={s.iconPicker}><label htmlFor={`${id}-icon`}>Player icon <small>(optional)</small></label>
      <select id={`${id}-icon`} value={identity.icon} onChange={event => identity.setIcon(event.target.value as PlayerIcon | '')} disabled={disabled}>
        <option value="">Use my initial</option>{PLAYER_ICONS.map(choice => <option key={choice.emoji} value={choice.emoji}>{choice.emoji} {choice.label}</option>)}
      </select>
    </div>
  </>;
}

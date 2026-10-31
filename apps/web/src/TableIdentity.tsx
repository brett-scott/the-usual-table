import { useId, useState } from 'react';
import { displayNameSchema, PLAYER_ICONS, playerIconSchema, type PlayerIcon } from '@casual/protocol';
import { useAccountState } from './AccountControls';
import s from './App.module.css';

function saved(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
export function useTableIdentity() {
  const account = useAccountState();
  const [name, setName] = useState(() => saved('casual-name'));
  const [icon, setIcon] = useState<PlayerIcon | ''>(() => playerIconSchema.safeParse(saved('casual-player-icon')).data ?? '');
  return {
    name, setName, icon, setIcon, signedIn: !!account.account,
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

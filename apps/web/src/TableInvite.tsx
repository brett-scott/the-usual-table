import { useId, useRef, useState } from 'react';
import { roomIdFromHash, shortRoomHash } from '@casual/protocol';
import s from './TableInvite.module.css';

export function TableInvite() {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null); const id = useId();
  const [link, setLink] = useState(''); const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState('');
  function show() {
    const url = new URL(location.href); const room = roomIdFromHash(url.hash);
    url.search = ''; if (room) url.hash = shortRoomHash(room);
    setLink(url.href); setFeedback(''); dialog.current?.showModal();
  }
  async function copy() {
    if (copying) return;
    setCopying(true); setFeedback('');
    try {
      await navigator.clipboard.writeText(link);
      setFeedback('Link copied. Send it to your friends.');
    } catch {
      setFeedback('Copy unavailable. Select the link and copy it manually.');
      if (dialog.current?.open) { input.current?.focus(); input.current?.select(); }
    } finally { setCopying(false); }
  }
  return <>
    <button ref={trigger} aria-haspopup="dialog" onClick={show}>Invite</button>
    <dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onClose={() => { if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) trigger.current?.focus(); }}>
      <header className={s.heading}><h2 id={`${id}-title`}>Invite friends</h2><button type="button" aria-label="Close invitation" onClick={() => dialog.current?.close()}>×</button></header>
      <p id={`${id}-help`}>Send this link to invite friends to your table. Up to four players can take a seat.</p>
      <label htmlFor={`${id}-link`}>Invitation link</label>
      <input ref={input} id={`${id}-link`} value={link} readOnly onFocus={event => event.currentTarget.select()} />
      <div className={s.actions}><button type="button" disabled={copying} onClick={() => { void copy(); }}>{copying ? 'Copying…' : 'Copy link'}</button></div>
      <p className={s.feedback} role="status" aria-live="polite">{feedback}</p>
    </dialog>
  </>;
}

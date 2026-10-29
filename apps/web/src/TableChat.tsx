import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH, type ChatFeed, type GameClient } from '@casual/protocol';
import s from './TableChat.module.css';
import { useWideChat } from './useWideChat';

const empty: ChatFeed = { messages: [], available: false, unread: 0 };
export function TableChat({ client, ownTurn, seconds }: { client: GameClient; ownTurn: boolean; seconds: number | null }) {
  const feed = useSyncExternalStore(client.subscribe, () => client.getChat?.() ?? empty);
  const connection = useSyncExternalStore(client.subscribe, client.getConnection);
  const wide = useWideChat();
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const [open, setOpen] = useState(false); const unread = feed.unread;
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  const inFlight = useRef(false); const you = client.getSnapshot().you;
  useEffect(() => {
    if (!open || wide) return;
    const viewport = window.visualViewport;
    function fit() {
      const height = viewport?.height ?? window.innerHeight;
      dialog.current?.style.setProperty('--chat-view-height', `${height}px`);
      dialog.current?.style.setProperty('--chat-center', `${(viewport?.offsetTop ?? 0) + height / 2}px`);
    }
    fit(); viewport?.addEventListener('resize', fit); viewport?.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    return () => { viewport?.removeEventListener('resize', fit); viewport?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit); };
  }, [open, wide]);
  useEffect(() => {
    if (wide) setOpen(false);
    const read = () => { if (wide && document.visibilityState === 'visible' && document.hasFocus() && atBottom.current) client.markChatRead?.(); };
    window.addEventListener('focus', read); document.addEventListener('visibilitychange', read);
    return () => { window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', read); };
  }, [wide, client]);
  useEffect(() => {
    if ((wide || open && dialog.current?.open) && atBottom.current) {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
      if (!wide || document.visibilityState === 'visible' && document.hasFocus()) client.markChatRead?.();
    }
  }, [client, feed, open, wide]);
  function show() {
    dialog.current?.showModal(); setOpen(true); client.markChatRead?.(); atBottom.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    input.current?.focus();
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !draft.trim() || !client.sendChat) return;
    inFlight.current = true; setSending(true); setError('');
    try {
      await client.sendChat(draft); setDraft(''); atBottom.current = true;
      if (wide || dialog.current?.open) {
        client.markChatRead?.();
        if (log.current) log.current.scrollTop = log.current.scrollHeight;
      }
    }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Your message could not be sent.'); }
    finally {
      inFlight.current = false; setSending(false);
      if (document.activeElement === document.body || input.current?.form?.contains(document.activeElement)) input.current?.focus();
    }
  }
  const connected = connection.status === 'connected' && feed.available;
  const content = <>
      <div className={s.heading}><div><h2 id="table-chat-title">Table chat</h2><p>Just the guests at this table · Last 50 messages</p></div>{wide && unread > 0 && <button className={s.newMessages} aria-label={`Show ${unread} new messages`} onClick={() => { atBottom.current = true; if (log.current) log.current.scrollTop = log.current.scrollHeight; client.markChatRead?.(); }}>↓ {unread}</button>}{!wide && <button className={s.close} onClick={() => dialog.current?.close()} aria-label="Close table chat">✕</button>}</div>
      {!wide && ownTurn && seconds !== null && <button className={s.turn} onClick={() => dialog.current?.close()}>Your hand · {seconds}s left — Back to hand</button>}
      <div ref={log} className={s.messages} role="log" aria-label="Table messages" aria-live={wide || open ? 'polite' : 'off'} aria-relevant="additions" tabIndex={0} onScroll={() => {
        const node = log.current; atBottom.current = !!node && node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        if ((wide ? document.visibilityState === 'visible' && document.hasFocus() : dialog.current?.open) && atBottom.current) client.markChatRead?.();
      }}>
        {!feed.messages.length && <p className={s.empty}>Say hello to the table.</p>}
        {feed.messages.map(message => <article key={message.id} className={message.playerId === you ? s.own : undefined}>
          <div><strong>{message.name}</strong><span>Seat {message.seat + 1}{message.playerId === you ? ' · You' : ''}</span><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
          <p>{message.text}</p>
        </article>)}
      </div>
      {(!connected || feed.problem) && <p className={s.notice} role="status">{feed.problem ?? (connection.status === 'connected' ? 'Connecting table chat…' : connection.message)}</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <form className={s.composer} onSubmit={event => { void send(event); }}>
        <label htmlFor="chat-message">Message <span>{draft.length}/{CHAT_MAX_LENGTH}</span></label>
        <div><input ref={input} id="chat-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={CHAT_MAX_LENGTH} placeholder="Say something…" autoComplete="off" disabled={sending} /><button className={s.send} type="submit" disabled={!connected || sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button></div>
      </form>
  </>;
  return <>
    {!wide && <button ref={trigger} onClick={show} aria-haspopup="dialog" data-chat-ready={connected} aria-label={`Table chat${unread ? `, ${unread} unread ${unread === 1 ? 'message' : 'messages'}` : ''}`}>Chat{unread > 0 && <span className={s.badge}>{unread}</span>}</button>}
    {wide ? <aside className={s.sidebar} role="region" aria-labelledby="table-chat-title" data-chat-ready={connected}>{content}</aside> : <dialog ref={dialog} className={s.panel} aria-labelledby="table-chat-title" onClose={() => {
      setOpen(false);
      if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) trigger.current?.focus();
    }}>{content}</dialog>}
  </>;
}

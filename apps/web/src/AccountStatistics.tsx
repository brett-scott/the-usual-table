import { useEffect, useId, useRef, useState } from 'react';
import { accountStatisticsSchema, GAME_CATALOG, type AccountStatistics, type GameStatistics } from '@casual/protocol';
import { browserAuth } from './authClient';
import s from './AccountStatistics.module.css';

export function statisticsChips(units: string, signed = false) {
  const value = BigInt(units); const absolute = value < 0n ? -value : value;
  const fraction = String(absolute % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${value < 0n ? '−' : signed && value > 0n ? '+' : ''}${new Intl.NumberFormat('en').format(absolute / 100n)}${fraction ? `.${fraction}` : ''}`;
}
const empty: GameStatistics = { gameId: 'blackjack', roundsPlayed: '0', roundsWon: '0', roundsLost: '0', roundsEven: '0', wageredUnits: '0', returnedUnits: '0', netUnits: '0', bestRoundNetUnits: '0' };
type State = { owner: string | null; status: 'loading' | 'ready' | 'error' | 'not-connected'; data?: AccountStatistics };

export function AccountStatisticsDialog({ open, accountId: owner, onClose }: { open: boolean; accountId: string | null; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const opener = useRef<HTMLElement | null>(null); const titleId = useId();
  const [refresh, setRefresh] = useState(0); const [state, setState] = useState<State>({ owner: null, status: 'loading' });
  useEffect(() => {
    if (open && owner) {
      if (!dialog.current?.open) { opener.current = document.activeElement as HTMLElement | null; dialog.current?.showModal(); }
    } else dialog.current?.close();
  }, [open, owner]);
  useEffect(() => {
    if (!open || !owner) return;
    const request = new AbortController(); let active = true;
    setState({ owner, status: 'loading' });
    void (async () => {
      try {
        const token = await browserAuth().accessToken();
        if (!active) return;
        const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
        const response = await fetch(`${base}/api/v1/account/statistics`, { headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
        const value: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 503 && value && typeof value === 'object' && 'code' in value && value.code === 'STATISTICS_NOT_CONNECTED') {
            if (active) setState({ owner, status: 'not-connected' }); return;
          }
          throw new Error('Statistics unavailable');
        }
        const data = accountStatisticsSchema.parse(value);
        if (data.accountId !== owner) throw new Error('Statistics account mismatch');
        if (active) setState({ owner, status: 'ready', data });
      } catch { if (active) setState({ owner, status: 'error' }); }
    })();
    return () => { active = false; request.abort(); };
  }, [open, owner, refresh]);
  const current = state.owner === owner ? state : { owner, status: 'loading' as const };
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={titleId} onClose={() => {
    if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) opener.current?.focus();
    onClose();
  }}>
    <header className={s.heading}><h2 id={titleId}>Your statistics</h2><button type="button" aria-label="Close statistics" onClick={() => dialog.current?.close()}>×</button></header>
    <p className={s.note}>Saved-chip games only. Temporary play isn’t recorded.</p>
    {open && owner && <>
      {current.status === 'loading' && <p role="status">Loading statistics…</p>}
      {current.status === 'error' && <p role="alert">Your statistics could not be loaded. Please try again.</p>}
      {current.status === 'not-connected' && <p role="status">Statistics are not connected yet.</p>}
      {current.status === 'ready' && current.data && <>
        {!current.data.games.length && <p>No saved rounds yet. Your results will appear here after you play with saved chips.</p>}
        {(current.data.games.length ? current.data.games : [empty]).map(game => <section className={s.game} key={game.gameId} aria-label={`${GAME_CATALOG.find(entry => entry.id === game.gameId)?.name ?? game.gameId} statistics`}>
          <h3>{GAME_CATALOG.find(entry => entry.id === game.gameId)?.name ?? game.gameId}</h3>
          <dl>
            <div><dt>Rounds played</dt><dd>{new Intl.NumberFormat('en').format(BigInt(game.roundsPlayed))}</dd></div>
            <div><dt>Won</dt><dd>{new Intl.NumberFormat('en').format(BigInt(game.roundsWon))}</dd></div>
            <div><dt>Lost</dt><dd>{new Intl.NumberFormat('en').format(BigInt(game.roundsLost))}</dd></div>
            <div><dt>Even</dt><dd>{new Intl.NumberFormat('en').format(BigInt(game.roundsEven))}</dd></div>
            <div><dt>Chips wagered</dt><dd>{statisticsChips(game.wageredUnits)}</dd></div>
            <div><dt>Chips returned</dt><dd>{statisticsChips(game.returnedUnits)}</dd></div>
            <div><dt>Net chips</dt><dd>{statisticsChips(game.netUnits, true)}</dd></div>
            <div><dt>Best round</dt><dd>{statisticsChips(game.bestRoundNetUnits, true)}</dd></div>
          </dl>
        </section>)}
        <p className={s.note}>Each round includes all your hands and insurance. Results update after the round is saved.</p>
      </>}
      <button className={s.refresh} type="button" disabled={current.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>{current.status === 'error' || current.status === 'not-connected' ? 'Retry statistics' : 'Refresh statistics'}</button>
    </>}
  </dialog>;
}

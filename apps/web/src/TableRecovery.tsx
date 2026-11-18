import { AccountControls } from './AccountControls';
import s from './TableRecovery.module.css';

type TableRecoveryProps =
  | { state: 'loading' }
  | { state: 'expired'; browseHref?: string }
  | { state: 'unavailable'; message: string; onRetry: () => void };

export function TableRecovery(props: TableRecoveryProps) {
  const expired = props.state === 'expired';
  return <div className={s.page}>
    <header className={s.header}>
      <a className={s.brand} href="#/games"><span aria-hidden="true">♣</span>The Usual Table</a>
      <AccountControls />
    </header>
    <main className={s.main}>
      <div className={s.panel}>
        {props.state === 'loading' ? <p role="status">Opening your table…</p> : <>
          <h1>{expired ? 'Table expired' : 'Table unavailable'}</h1>
          <p>{expired ? 'Ask the host for a new invitation to play together.' : props.message}</p>
          <div className={s.actions}>
            <a className={s.primary} href={expired ? props.browseHref ?? '#/games' : '#/games'}>Find or create another table</a>
            {props.state === 'unavailable' && <button className={s.retry} type="button" onClick={props.onRetry}>Retry table</button>}
          </div>
        </>}
      </div>
    </main>
  </div>;
}

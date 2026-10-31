// Browser-only presentation fixture. Bundled in memory by Playwright, never served or published by the app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PLAYER_ICONS, type GameClient, type PlayerIcon } from '@casual/protocol';
import { Table } from '../../apps/web/src/App';
import { AccountProvider } from '../../apps/web/src/AccountControls';
import { createPracticeClient } from '../../apps/web/src/practiceClient';
import '../../apps/web/src/global.css';
import s from '../../apps/web/src/App.module.css';

function EngineFixture() {
  const [client, setClient] = useState<GameClient | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('casual-name') ?? '');
  const [icon, setIcon] = useState<PlayerIcon | ''>('');
  return client ? <Table client={client} onLeave={() => { client.dispose(); setClient(null); }} /> : <main className={s.welcome}>
    <form className={s.nameForm} onSubmit={event => {
      event.preventDefault(); localStorage.setItem('casual-name', name); setClient(createPracticeClient(name, icon || undefined));
    }}>
      <label htmlFor="fixture-name">What should we call you?</label><input id="fixture-name" value={name} required onChange={event => setName(event.target.value)} />
      <label htmlFor="fixture-icon">Player icon</label><select id="fixture-icon" value={icon} onChange={event => setIcon(event.target.value as PlayerIcon | '')}>
        <option value="">Use my initial</option>{PLAYER_ICONS.map(choice => <option key={choice.emoji} value={choice.emoji}>{choice.emoji} {choice.label}</option>)}
      </select>
      <button className={s.primary} type="submit">Take a practice seat</button>
    </form>
  </main>;
}
createRoot(document.getElementById('root')!).render(<AccountProvider><EngineFixture /></AccountProvider>);

import { useEffect, useRef, useState } from 'react';
import './DuckRace.css';
import room from './CrashTable.module.css';
import chrome from './App.module.css';
import { AccountControls } from './AccountControls';

const names = ['Sir Quacksalot', 'Puddles', 'Daisy', 'Quackpot', 'Waffles', 'Ducky Stardust', 'Pickles', 'Noodles', 'Bubbles', 'Captain Flap', 'Marshmallow', 'Waddles', 'Marmalade', 'Doodle', 'Peaches', 'Disco'];
function Duck({ hat }: { hat: number }) {
  return <svg className="duck-art" viewBox="0 0 100 82" aria-hidden="true">
    <ellipse cx="42" cy="73" rx="30" ry="4" fill="#102d27" opacity=".35" />
    <g className="duck-feet" fill="#e68b32"><path d="M38 63l-5 7h12l3-7z"/><path d="M56 63l-2 7h12l2-7z"/></g>
    <path d="M15 42 Q20 65 47 65 Q68 65 73 44 Q62 50 54 39 Q42 29 26 36 L15 31Z" fill="var(--duck-color)" stroke="#816c3d" strokeWidth="2"/>
    <path d="M26 44 Q40 37 52 45 Q45 58 31 54 Q25 51 26 44Z" fill="var(--duck-wing)"/>
    <circle cx="67" cy="32" r="16" fill="var(--duck-color)" stroke="#816c3d" strokeWidth="2"/>
    <path d="M79 33 Q95 31 94 37 Q89 42 79 40Z" fill="#e78630" stroke="#a25b27" strokeWidth="1.5"/>
    <circle cx="73" cy="29" r="2.3" fill="#252822"/>
    {hat === 0 && <g><path d="M56 22l2-17h19l2 17z" fill="#52315a" stroke="#24172c" strokeWidth="2"/><path d="M55 17h23v4H55z" fill="#db6580"/><path d="M52 22h31" stroke="#24172c" strokeWidth="4" strokeLinecap="round"/></g>}
    {hat === 1 && <g><path d="M54 20l-2-13 8 6 7-10 6 10 9-6-3 13z" fill="#f4c54f" stroke="#9e6d28" strokeWidth="2"/><circle cx="67" cy="15" r="2" fill="#dd5b65"/></g>}
    {hat === 2 && <g><path d="M57 20V12h21v8z" fill="#3c365f"/><path d="M49 10l18-8 19 8-19 8z" fill="#4c4473" stroke="#27203f" strokeWidth="2"/><path d="M83 11v10" stroke="#efc85a" strokeWidth="2"/></g>}
    {hat === 3 && <g><path d="M58 19q1-14 5-14 4 5 8 0 5 0 7 14z" fill="#a86a38" stroke="#593a27" strokeWidth="2"/><path d="M50 19q17 8 34 0" fill="#c48a50" stroke="#593a27" strokeWidth="3"/></g>}
  </svg>;
}
function randomNames() {
  const pool = [...names];
  return Array.from({length: 4}, () => { const random = new Uint32Array(1); crypto.getRandomValues(random); return pool.splice(random[0]! % pool.length, 1)[0]!; });
}
const colors = ['#ffd35a', '#72d9ee', '#ff91aa', '#b3a3ff'];
const wings = ['#e9aa39', '#42a8be', '#dc6683', '#8670d4'];
type Phase = 'betting' | 'racing' | 'results';
export function DuckRace() {
  const [ducks] = useState(randomNames);
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(100);
  const [pick, setPick] = useState(0);
  const [phase, setPhase] = useState<Phase>('betting');
  const [positions, setPositions] = useState([0, 0, 0, 0]);
  const [winner, setWinner] = useState<number | null>(null);
  const frame = useRef<number>(0);
  const rules = useRef<HTMLDialogElement>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  function race() {
    if (!Number.isInteger(bet) || bet < 1 || bet > 1000 || bet > balance) return;
    setBalance(value => value - bet); setWinner(null); setPositions([0, 0, 0, 0]); setPhase('racing');
    const random = new Uint32Array(5); crypto.getRandomValues(random);
    const chosen = random[0]! % 4;
    const offsets = Array.from(random.slice(1), n => n / 4294967296 * Math.PI * 2);
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 10000);
      const next = ducks.map((_, i) => {
        const finish = i === chosen ? 100 : 91 + (random[i + 1]! % 6);
        const phase = offsets[i]!;
        const variation = 3 * (Math.sin(2 * Math.PI * t + phase) - Math.sin(phase)) + 1.2 * (Math.sin(4 * Math.PI * t + phase) - Math.sin(phase));
        return Math.max(0, Math.min(finish, finish * t + variation));
      });
      setPositions(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else { setWinner(chosen); setPhase('results'); if (chosen === pick) setBalance(value => value + bet * 4); }
    };
    frame.current = requestAnimationFrame(tick);
  }
  const leader = positions.indexOf(Math.max(...positions));
  return <div className={room.app}><header className={chrome.header}><a href="#/games" className={chrome.brand}><span className={chrome.brandMark}>♣</span><span>The Usual Table</span></a><div className={chrome.headerActions}><button onClick={() => rules.current?.showModal()}>Rules</button><AccountControls signedInOnly /></div></header>
  <main className={room.main} style={{'--seat-rows':1,'--phone-seat-rows':1} as React.CSSProperties}>
    <div className={room.toolbar}><div className={chrome.tableToolbar}><span className={chrome.connectionBadge} data-status="connected"><i aria-hidden="true"/>Local practice</span><a className="duck-leave" href="#/games">Leave table ↗</a></div></div>
    <section className="duck-track" aria-label="Race track">{ducks.map((name, i) => <div className="duck-lane" key={name} style={{'--duck-color': colors[i], '--duck-wing': wings[i]} as React.CSSProperties}><div className="duck-name"><b>{i + 1}</b><span>{name}{pick === i && <small className="duck-bet-badge">YOUR PICK</small>}</span></div><div className="duck-course">{phase === 'results' && winner === i && <div className="duck-winner-banner" role="status"><strong>WINNER!</strong><span>{name}</span></div>}{phase === 'results' && pick === i && winner !== i && <div className="duck-winner-banner duck-lost-banner" role="status"><strong>YOU LOST</strong><span>{name}</span></div>}<div className="duck-finish"/><div className={'duck-path' + (phase !== 'betting' && leader === i ? ' leading' : '')} style={{width: positions[i] + '%'}}/><div className={'duck-runner' + (phase === 'racing' ? ' running' : '')} style={{left: positions[i] + '%'}}><span className="duck-character"><Duck hat={i}/></span></div></div></div>)}</section>
    <section className={room.players} aria-label="Players"><article className={room.player} data-own="true"><div><strong>You · Practice</strong><span>{phase === 'betting' ? 'Choose a duck' : phase === 'racing' ? 'Race in progress' : ducks[winner!] + ' wins'}</span></div></article></section>
    <section className={room.controls}><div className={room.balance}><span>YOUR TABLE CHIPS</span><strong>{balance.toLocaleString()} <small>chips</small></strong><p className="duck-status" role="status">{phase === 'results' ? <>{winner === pick ? 'You won ' + bet * 4 + ' chips!' : 'Your pick: ' + ducks[pick]}</> : phase === 'racing' ? <>Your bet: <strong>{ducks[pick]}</strong> · {bet.toLocaleString()} chips</> : 'Choose your duck and place a wager.'}</p></div>
      <div className="duck-actions"><div className="duck-picks">{ducks.map((name, i) => <button key={name} type="button" disabled={phase !== 'betting'} className={pick === i ? 'selected' : ''} style={{'--duck-color': colors[i]} as React.CSSProperties} onClick={() => setPick(i)}>{name}</button>)}</div>
      <div className="duck-bet"><label>Wager (chips)<input type="number" min="1" max="1000" value={bet} disabled={phase !== 'betting'} onChange={e => setBet(Number(e.target.value))}/></label>{phase === 'betting' ? <button className="duck-go" onClick={race} disabled={!Number.isInteger(bet) || bet < 1 || bet > 1000 || bet > balance}>Start race</button> : phase === 'results' ? <button className="duck-go" onClick={() => {setPositions([0,0,0,0]); setPhase('betting');}}>Race again</button> : <button className="duck-go" disabled>Racing…</button>}</div>
      {balance < 1 && phase === 'betting' && <button onClick={() => setBalance(1000)}>Refill practice chips</button>}<small>1–1,000 chips per race · 4× payout</small></div></section>
  </main><dialog ref={rules} className={room.rules} aria-label="Duck Race rules"><header><h2>Duck Race rules</h2><button onClick={() => rules.current?.close()} aria-label="Close rules">×</button></header><p>Pick one of four ducks and wager 1–1,000 chips. If your duck wins, you receive four times your wager, including your original bet.</p><p>This is a local practice room using temporary chips.</p></dialog></div>;
}

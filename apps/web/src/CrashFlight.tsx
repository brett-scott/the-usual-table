import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CrashSnapshot } from '@casual/protocol';
import s from './CrashFlight.module.css';
import { crashGraphGeometry } from './crashGraph';

type Props = {
  phase: CrashSnapshot['phase'];
  cents: number;
  graphCents:number;
  seconds: number | null;
  history: CrashSnapshot['history'];
  elapsedMs: number;
  capped?: boolean;
};
const multiplier = (cents: number) => `${(cents / 100).toFixed(2)}×`;

function FlightGraph({ phase, cents, graphCents, elapsedMs, capped }: Pick<Props, 'phase' | 'cents' | 'graphCents' | 'elapsedMs' | 'capped'>) {
  const id = useId(); const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 420, height: 200 });
  useLayoutEffect(() => {
    const node = svg.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.max(1, Math.round(entry.contentRect.width)); const height = Math.max(1, Math.round(entry.contentRect.height));
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const active = phase === 'running' || phase === 'results';
  const value = active ? Math.max(100, graphCents) / 100 : 1;
  const elapsed = active ? Math.max(0, elapsedMs) / 1000 : 0;
  const {maxTime,maxValue,left,right,top,bottom,x,y,line,endpoint,angle}=crashGraphGeometry(value,elapsed,size.width,size.height);
  const crashed = phase === 'results' && !capped;
  const tick = (amount: number) => `${Number(amount.toFixed(amount < 10 ? 1 : 0))}×`;
  const levels = size.height < 90 ? [1, maxValue] : [1, 1 + (maxValue - 1) / 2, maxValue];
  return <svg ref={svg} className={s.graph} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    data-confirmed-cents={cents} data-elapsed-ms={elapsedMs} data-rendered-cents={graphCents} data-time-domain={maxTime} data-multiplier-domain={maxValue}>
    <title id={`${id}-title`}>Crash flight graph</title>
    <desc id={`${id}-description`}>{active ? `Confirmed flight at ${multiplier(cents)} after ${elapsed.toFixed(1)} seconds.${crashed ? ' The flight has crashed.' : capped ? ' The ceiling was reached.' : ''}` : 'The flight path begins at 1.00× when betting closes.'}</desc>
    <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18" /><stop offset="1" stopColor="currentColor" stopOpacity=".015" /></linearGradient></defs>
    {levels.map(amount => <g key={amount}>
      <line className={s.gridLine} x1={left} x2={right} y1={y(amount)} y2={y(amount)} />
      <text className={s.axisLabel} x={left - 14} y={y(amount) + 3} textAnchor="end">{tick(amount)}</text>
    </g>)}
    {[0, maxTime / 2, maxTime].map(seconds => <g key={seconds}>
      <line className={s.gridLine} x1={x(seconds)} x2={x(seconds)} y1={top} y2={bottom} />
      <text className={s.axisLabel} x={x(seconds)} y={bottom + 16} textAnchor="middle">{Number(seconds.toFixed(1))}s</text>
    </g>)}
    <line className={s.baseline} x1={left} x2={right} y1={bottom} y2={bottom} />
    {active && <>
      <path d={`${line} L ${endpoint.x.toFixed(2)},${bottom} L ${left},${bottom} Z`} fill={`url(#${id}-fill)`} />
      <path className={s.trajectory} data-flight-line d={line} />
    </>}
    <g className={s.endpoint} style={{ transform: `translate(${endpoint.x}px, ${endpoint.y}px) rotate(${crashed ? 0 : angle}deg)` } as CSSProperties}>
      {crashed ? <><circle r="7" className={s.impact} /><path className={s.impactMark} d="M -11 -11 L -7 -7 M 11 -11 L 7 -7 M -11 11 L -7 7 M 11 11 L 7 7" /></>
        : <path className={s.plane} d="M -9 -2 L -2 -3 L 2 -10 L 5 -10 L 4 -3 L 10 -1 L 10 1 L 4 3 L 5 10 L 2 10 L -2 3 L -9 2 Z" />}
    </g>
  </svg>;
}

export function CrashFlight({ phase, cents, graphCents, seconds, history, elapsedMs, capped = false }: Props) {
  const betting = phase === 'betting'; const running = phase === 'running'; const result = phase === 'results';
  const remaining = seconds === null ? null : Math.max(0, Math.min(10, seconds));
  const phaseLabel = phase === 'waiting' ? 'Ready for take-off' : betting ? 'Betting is open' : running ? 'In flight' : capped ? 'Ceiling reached' : 'Crashed';
  return <div className={s.flight} data-flight-phase={phase} data-capped={capped}>
    <header className={s.header}><h1>Crash<span className={s.subtitle}>One flight. Your moment.</span></h1><span className={s.phase} data-flight-status={phase} role="status"><i aria-hidden="true" />{phaseLabel}</span></header>
    <div className={s.stage}>
      <div className={s.readout}>
        {betting ? <div className={s.countdown} role="timer" aria-label="Betting countdown" aria-live="off" data-urgent={remaining !== null && remaining <= 3}>
          <strong>{remaining === null ? '—' : `${remaining}s`}</strong><span>until betting closes</span>
          <progress max={10} value={remaining ?? 0} aria-label="Betting time remaining" />
        </div> : <>
          <strong className={s.multiplier} aria-label="Current multiplier" data-large={cents >= 1000}>{multiplier(cents)}</strong>
          {result ? <span className={s.nextRound} role="timer" aria-label="Next round countdown" aria-live="off">Next flight in {seconds ?? '—'}s</span>
            : <span className={s.hint}>{running ? 'Cash out before the crash' : 'The host starts the next flight'}</span>}
        </>}
      </div>
      <FlightGraph phase={phase} cents={cents} graphCents={graphCents} elapsedMs={elapsedMs} capped={capped} />
    </div>
    <section className={s.history} aria-label="Last 10 Crash results">
      <header><h2>Last 10 results</h2><span>Newest first</span></header>
      {history.length ? <ol>{history.map(item => <li key={item.roundId} data-high={item.multiplierCents >= 200}
        aria-label={`Round ${item.roundId}: ${multiplier(item.multiplierCents)}${item.capped ? ', ceiling reached' : ''}`}>
        {multiplier(item.multiplierCents)}{item.capped && <span aria-hidden="true"> ✓</span>}
      </li>)}</ol> : <p>No completed flights in this lobby yet.</p>}
    </section>
  </div>;
}

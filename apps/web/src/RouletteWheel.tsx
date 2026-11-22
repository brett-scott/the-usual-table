import { useId, useLayoutEffect, useRef } from 'react';
import { ROULETTE_SPIN_MS, ROULETTE_WHEEL, rouletteColor, type RouletteSnapshot } from '@casual/protocol';
import { landingFrame, planRouletteLanding, POCKET_STEP, scheduleRouletteLanding, spinFrame, type WheelFrame } from './rouletteWheelMotion';
import s from './RouletteTable.module.css';

function point(radius: number, degrees: number) {
  const angle = degrees * Math.PI / 180;
  return { x: 100 + radius * Math.sin(angle), y: 100 - radius * Math.cos(angle) };
}

function sector(inner: number, outer: number, angle: number) {
  const left = angle - POCKET_STEP / 2;
  const right = angle + POCKET_STEP / 2;
  const start = point(outer, left);
  const end = point(outer, right);
  const innerStart = point(inner, left);
  const innerEnd = point(inner, right);
  return `M${start.x} ${start.y}A${outer} ${outer} 0 0 1 ${end.x} ${end.y}L${innerEnd.x} ${innerEnd.y}A${inner} ${inner} 0 0 0 ${innerStart.x} ${innerStart.y}Z`;
}

const pockets = ROULETTE_WHEEL.map((number, index) => {
  const angle = index * POCKET_STEP;
  return { number, angle, color: rouletteColor(number), label: point(65, angle), band: sector(59, 71, angle), slot: sector(43, 59, angle) };
});

interface Playback {
  roundId: number;
  elapsed: number;
  frame: WheelFrame;
  landing?: { plan: ReturnType<typeof scheduleRouletteLanding>; elapsed: number };
}

export function RouletteWheel({state, offset, reduced, landAt, onLanded, landed, highlight}: {
  state: RouletteSnapshot;
  offset: number | undefined;
  reduced: boolean;
  landAt: number | null;
  onLanded(roundId: number): void;
  landed: boolean;
  highlight: boolean;
}) {
  const { phase, roundId, startedAt, winner } = state;
  const svg = useRef<SVGSVGElement>(null);
  const rotor = useRef<SVGGElement>(null);
  const ball = useRef<SVGGElement>(null);
  const shadow = useRef<SVGEllipseElement>(null);
  const playback = useRef<Playback | null>(null);
  const announcedRound = useRef<number | null>(null);
  const id = useId();
  const fill = (name: string) => `url(#${id}-${name})`;

  useLayoutEffect(() => {
    let animation: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const priorSpin = playback.current?.roundId === roundId ? playback.current : null;
    const serverTime = () => Date.now() + (offset ?? 0);
    const paint = (frame: WheelFrame) => {
      const position = point(frame.radius, frame.ball);
      rotor.current?.setAttribute('transform', `rotate(${frame.rotor} 100 100)`);
      ball.current?.setAttribute('transform', `translate(${position.x} ${position.y}) scale(${1 + frame.lift * 0.13})`);
      shadow.current?.setAttribute('transform', `translate(${position.x + 0.6} ${position.y + 0.9})`);
      shadow.current?.setAttribute('opacity', String(0.62 - frame.lift * 0.28));
      svg.current?.setAttribute('data-wheel-angle', String(frame.rotor));
      svg.current?.setAttribute('data-ball-angle', String(frame.ball));
      svg.current?.setAttribute('data-ball-radius', String(frame.radius));
    };

    if (phase === 'spinning' && startedAt !== null && offset !== undefined) {
      const spinStart = startedAt;
      function orbit() {
        const elapsed = Math.max(playback.current?.roundId === roundId ? playback.current.elapsed : 0, serverTime() - spinStart);
        const frame = spinFrame(roundId, reduced ? 0 : elapsed);
        playback.current = { roundId, elapsed, frame };
        paint(frame);
        if (!reduced) animation = requestAnimationFrame(orbit);
      }
      orbit();
    } else if (phase === 'results' && winner !== null && landAt !== null && offset !== undefined) {
      const deadline = landAt;
      const serverNow = serverTime();
      const from = priorSpin?.frame ?? spinFrame(roundId, startedAt === null ? ROULETTE_SPIN_MS : serverNow - startedAt);
      const remaining = deadline - serverNow;
      const current = priorSpin ?? { roundId, elapsed: 0, frame: from };
      const landing = current.landing ??= { plan: scheduleRouletteLanding(from, winner, remaining), elapsed: 0 };
      playback.current = current;
      const plan = landing.plan;
      const finish = () => {
        const finalPlan = plan ?? planRouletteLanding(from, winner);
        paint(landingFrame(finalPlan, finalPlan.durationMs));
        if (announcedRound.current !== roundId) {
          announcedRound.current = roundId;
          onLanded(roundId);
        }
      };
      if (remaining <= 0 || announcedRound.current === roundId) finish();
      else if (reduced || !plan) {
        paint(plan ? landingFrame(plan, landing.elapsed) : from);
        timer = setTimeout(finish, remaining);
      } else {
        const settle = () => {
          const timeLeft = deadline - serverTime();
          if (timeLeft <= 0) { finish(); return; }
          landing.elapsed = Math.max(landing.elapsed, plan.durationMs - timeLeft);
          paint(landingFrame(plan, landing.elapsed));
          animation = requestAnimationFrame(settle);
        };
        settle();
      }
    } else {
      playback.current = null;
      paint(spinFrame(roundId, 0));
    }

    return () => { if (animation !== undefined) cancelAnimationFrame(animation); clearTimeout(timer); };
  }, [phase, roundId, startedAt, winner, landAt, offset, reduced, onLanded]);

  const label = landed ? `Roulette wheel, winning number ${winner}`
    : phase === 'results' ? 'Roulette wheel, ball settling'
    : phase === 'spinning' ? 'Roulette wheel spinning' : 'European single-zero Roulette wheel';
  return <svg ref={svg} className={s.wheel} viewBox="0 0 200 200" role="img" aria-label={label}>
    <defs>
      <radialGradient id={`${id}-wood`} cx="42%" cy="28%">
        <stop offset="55%" stopColor="#866144"/><stop offset="87%" stopColor="#654328"/><stop offset="100%" stopColor="#2b1d15"/>
      </radialGradient>
      <radialGradient id={`${id}-track`}>
        <stop offset="75%" stopColor="#282720"/><stop offset="80%" stopColor="#4d4430"/>
        <stop offset="86%" stopColor="#79684a"/><stop offset="94%" stopColor="#272821"/><stop offset="100%" stopColor="#4d4839"/>
      </radialGradient>
      <radialGradient id={`${id}-hub`}>
        <stop stopColor="#5e6a52"/><stop offset="65%" stopColor="#334036"/><stop offset="100%" stopColor="#1c2723"/>
      </radialGradient>
      <linearGradient id={`${id}-metal`} x2="0" y2="1">
        <stop stopColor="#f0d8a0"/><stop offset="50%" stopColor="#b39158"/><stop offset="100%" stopColor="#735331"/>
      </linearGradient>
      <radialGradient id={`${id}-ivory`} cx="34%" cy="26%" r="73%">
        <stop stopColor="#fffef5"/><stop offset="62%" stopColor="#f2e4bd"/><stop offset="100%" stopColor="#aa9971"/>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="98" fill={fill('wood')} stroke="#ab8958" strokeWidth="1"/>
    <circle cx="100" cy="100" r="95" fill="none" stroke="#daab71" strokeOpacity=".48" strokeWidth=".7"/>
    <circle cx="100" cy="100" r="91.5" fill={fill('track')} stroke="#c0a371" strokeWidth="1.2"/>
    <circle cx="100" cy="100" r="89" fill="none" stroke="#f0d5a7" strokeOpacity=".29" strokeWidth=".5"/>
    <circle cx="100" cy="100" r="82.5" fill="none" stroke="#241d16" strokeOpacity=".55" strokeWidth=".7"/>
    {Array.from({length:8}, (_, i) => <path key={i} d="M96.5 22 100 20 103.5 22 100 24Z" fill={fill('metal')} stroke="#493522" strokeWidth=".45" transform={`rotate(${i * 45 + 12} 100 100)`}/>)}
    <g ref={rotor}>
      <circle cx="100" cy="100" r="72" fill="#9b8056" stroke="#35281b" strokeWidth=".8"/>
      {pockets.map(({number, angle, color, label, band, slot}) => {
        const winning = highlight && number === winner;
        return <g key={number} data-winning-pocket={winning}>
          <path d={band} fill={color === 'green' ? '#306b4a' : color === 'red' ? '#923a36' : '#242c2a'} stroke="#b49865" strokeWidth=".4"/>
          <path d={slot} fill={color === 'green' ? '#235239' : color === 'red' ? '#602c2a' : '#151d1b'} stroke="#a28657" strokeWidth=".75"/>
          {winning && <path d={slot} fill="#e7bc652d" stroke="#fff0ad" strokeWidth="1.25"/>}
          <text x={label.x} y={label.y} dy="2.2" transform={`rotate(${angle} ${label.x} ${label.y})`} textAnchor="middle" fill="#fff5dc" fontSize="7" fontWeight={winning ? 750 : 600}>{number}</text>
        </g>;
      })}
      <circle cx="100" cy="100" r="59" fill="none" stroke="#d8b878" strokeWidth=".85"/>
      <circle cx="100" cy="100" r="42.7" fill={fill('hub')} stroke="#b19260" strokeWidth="1"/>
      <circle cx="100" cy="100" r="35" fill="none" stroke="#aab196" strokeOpacity=".35" strokeWidth=".65"/>
      <circle cx="100" cy="100" r="19" fill="#202d25" stroke="#887348" strokeWidth=".7"/>
      <path d="M97 75h6l2 17 20 5v6l-20 2-2 20h-6l-2-20-20-2v-6l20-5Z" fill={fill('metal')} stroke="#5c482b" strokeWidth=".7"/>
      <circle cx="100" cy="100" r="10" fill={fill('metal')} stroke="#765b38" strokeWidth=".8"/>
      <circle cx="100" cy="100" r="5" fill="#e6cd97"/>
    </g>
    <ellipse ref={shadow} rx="3.1" ry="2" fill="#120e0a"/>
    <g ref={ball}><circle r="2.85" fill={fill('ivory')} stroke="#c5b389" strokeWidth=".35"/></g>
    {highlight && winner !== null && <g role="group" aria-label={`Winning number ${winner} ${rouletteColor(winner)}`}>
      <circle cx="100" cy="100" r="33" fill={winner === 0 ? '#235239' : rouletteColor(winner) === 'red' ? '#73352e' : '#182622'} stroke="#f4d68e" strokeWidth="1.6"/>
      <text x="100" y="111" textAnchor="middle" fill="#fff7e6" fontFamily="Georgia, serif" fontSize="37" fontWeight="700">{winner}</text>
    </g>}
  </svg>;
}

import { useLayoutEffect, useRef } from 'react';
import s from './WagerChips.module.css';
const denominations = [
  { units: 200, label: '100', color: '#303d49' }, { units: 50, label: '25', color: '#35734e' },
  { units: 20, label: '10', color: '#356d9a' }, { units: 10, label: '5', color: '#a54449' },
  { units: 2, label: '1', color: '#b8a881' }, { units: 1, label: '½', color: '#89629d' },
];
export function chipTokens(amount: number) {
  let remaining = Math.max(0, Math.floor(amount)); const chips: typeof denominations = [];
  for (const coin of denominations) while (remaining >= coin.units && chips.length < 7) { chips.push(coin); remaining -= coin.units; }
  return chips;
}
function Stack({ amount }: { amount: number }) {
  const chips = chipTokens(amount);
  return <svg viewBox="0 0 36 28" aria-hidden="true">{chips.map((chip, index) => <g key={index} transform={`translate(0 ${-index * 2.4})`}>
    <ellipse cx="18" cy="20" rx="14" ry="7" fill={chip.color} stroke="#111d18" strokeWidth="2" />
    <ellipse cx="18" cy="18" rx="14" ry="7" fill={chip.color} stroke="#efe4c4" strokeDasharray="4 4" strokeWidth="2" />
    <text x="18" y="20.5" textAnchor="middle" fill="#fff8df" fontSize="8" fontFamily="Arial" fontWeight="700">{chip.label}</text>
  </g>)}</svg>;
}
function playerTravel(element: HTMLElement) {
  const bounds = element.getBoundingClientRect(); const seat = element.closest('section')?.getBoundingClientRect();
  return Math.max(0, Math.min(34, (seat?.bottom ?? bounds.bottom + 40) - bounds.bottom - 6));
}
export function WagerChips({ amount, returned = 0, settled = false, reducedMotion = false, compact = false }: { amount: number; returned?: number; settled?: boolean; reducedMotion?: boolean; compact?: boolean }) {
  const stake = useRef<HTMLSpanElement>(null); const payout = useRef<HTMLSpanElement>(null); const wasSettled = useRef(settled);
  useLayoutEffect(() => {
    if (!stake.current || !amount || settled || reducedMotion) return;
    const animation = stake.current.animate([{ transform: `translateY(${playerTravel(stake.current)}px) scale(.6)`, opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { id: 'chips-place', duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
    return () => animation.cancel();
  }, [amount, settled, reducedMotion]);
  useLayoutEffect(() => {
    const shouldAnimate = settled && !wasSettled.current; wasSettled.current = settled;
    if (!shouldAnimate || reducedMotion || !stake.current) return;
    const towardsPlayer = playerTravel(stake.current);
    const taking = stake.current.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${returned ? towardsPlayer : -65}px) scale(.7)`, opacity: 0, offset: .95 }, { transform: 'none', opacity: 0 }], { id: returned ? 'chips-return' : 'chips-collect', duration: 700, fill: 'both', easing: 'ease-in-out' });
    const paying = payout.current?.animate([{ transform: 'translateY(-60px) scale(.7)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1, offset: .4 }, { transform: `translateY(${towardsPlayer}px) scale(.8)`, opacity: 0, offset: .95 }, { transform: 'none', opacity: 0 }], { id: 'chips-payout', duration: 1100, fill: 'both', easing: 'ease-in-out' });
    return () => { taking.cancel(); paying?.cancel(); };
  }, [settled, returned, reducedMotion]);
  if (!amount) return null;
  return <span className={`${s.chips} ${compact ? s.compact : ''}`} role="group" aria-label={`Wager ${amount / 2} chips${settled ? `, returned ${returned / 2} chips` : ''}`} data-chip-amount={amount} data-settled={settled}>
    <span ref={stake} className={s.stake}><Stack amount={amount} /></span>
    {settled && returned > amount && <span ref={payout} className={s.payout}><Stack amount={returned - amount} /></span>}
  </span>;
}

import { useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import { CardAppearance } from './cardAppearance';
import type { VisibleCard } from '@casual/protocol';
import { DEAL_MS, FLIP_MS, type CardCue } from './cardTimeline';
import s from './App.module.css';

const suits = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export function PlayingCard({ card, cue, shoeRef, reducedMotion = false }: {
  card: VisibleCard; cue?: CardCue; shoeRef?: RefObject<HTMLDivElement | null>; reducedMotion?: boolean;
}) {
  const travel = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const hidden = 'hidden' in card;
  const { face, back } = useContext(CardAppearance);
  const dealAt = cue?.dealAt;
  const revealAt = cue?.revealAt;
  useLayoutEffect(() => {
    const element = travel.current;
    if (!element || dealAt === undefined || reducedMotion) return;
    const destination = element.getBoundingClientRect();
    const source = shoeRef?.current?.getBoundingClientRect();
    const dx = source ? source.left + source.width / 2 - destination.left - destination.width / 2 : 60;
    const dy = source ? source.top + source.height / 2 - destination.top - destination.height / 2 : -80;
    const animation = element.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(-16deg) scale(.65)`, opacity: 0 },
      { opacity: 1, offset: .18 },
      { transform: 'translate(0, 0) rotate(0) scale(1)', opacity: 1 },
    ], { id: 'card-deal', duration: DEAL_MS, delay: dealAt - Date.now(), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
    return () => animation.cancel();
  }, [dealAt, reducedMotion, shoeRef]);
  useLayoutEffect(() => {
    if (!flipper.current || hidden || revealAt === undefined || revealAt === null || reducedMotion) return;
    const animation = flipper.current.animate([
      { transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' },
    ], { id: 'card-flip', duration: FLIP_MS, delay: revealAt - Date.now(), easing: 'ease-in-out', fill: 'both' });
    return () => animation.cancel();
  }, [hidden, revealAt, reducedMotion]);
  return <div className={s.card} role="img" aria-label={hidden ? 'Face-down dealer card' : `${card.rank} of ${card.suit}`} data-face={face} data-back={back} data-deal-at={dealAt} data-reveal-at={revealAt ?? undefined}>
    <div ref={travel} className={s.cardTravel}>
      <div ref={flipper} className={s.cardFlipper} style={{ transform: hidden ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        <div className={`${s.cardBack} ${back === 'geometric' ? s.geometricBack : ''}`} aria-hidden="true"><span>{back === 'geometric' ? '◇' : '♣'}</span></div>
        {!hidden && <svg className={`${s.cardFace} ${card.suit === 'hearts' || card.suit === 'diamonds' ? s.red : ''}`} viewBox="0 0 76 106" aria-hidden="true">
          <rect x=".5" y=".5" width="75" height="105" rx="6" fill="var(--card-paper)" stroke="#d8d2c3" />
          {face === 'large-index' ? <>
            <text x="6" y="32" fontSize={card.rank === '10' ? 30 : 34} fontWeight="800" fontFamily="Arial, sans-serif">{card.rank}</text><text x="9" y="55" fontSize="25">{suits[card.suit]}</text>
            <g transform="rotate(180 38 53)"><text x="6" y="32" fontSize={card.rank === '10' ? 30 : 34} fontWeight="800" fontFamily="Arial, sans-serif">{card.rank}</text><text x="9" y="55" fontSize="25">{suits[card.suit]}</text></g>
          </> : <>
            <text x="9" y="21" fontSize="18" fontWeight="700">{card.rank}</text><text x="9" y="36" fontSize="15">{suits[card.suit]}</text>
            <text x="38" y="66" textAnchor="middle" fontSize="36">{suits[card.suit]}</text>
            <g transform="rotate(180 38 53)"><text x="9" y="21" fontSize="18" fontWeight="700">{card.rank}</text><text x="9" y="36" fontSize="15">{suits[card.suit]}</text></g>
          </>}
        </svg>}
      </div>
    </div>
  </div>;
}

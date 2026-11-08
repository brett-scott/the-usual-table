import { useId, useRef } from 'react';
import { PlayingCard } from './PlayingCard';
import { CardAppearance, type CardBack, type CardFace } from './cardAppearance';
import s from './App.module.css';
import {COSMETICS} from '@casual/protocol';
type CardStyleProps = { face: CardFace; back: CardBack; onChange: (value: { face: CardFace; back: CardBack }) => void };

export function CardStyleFields({ face, back, onChange }: CardStyleProps) {
  const id = useId();
  return <div data-card-style-fields>
    <CardAppearance.Provider value={{ face, back }}><div className={s.stylePreview} data-card-preview>
      <PlayingCard card={{ id: 'preview', rank: 'A', suit: 'hearts' }} reducedMotion /><PlayingCard card={{ hidden: true }} reducedMotion />
    </div></CardAppearance.Provider>
    <div data-card-selectors>
      <div><label htmlFor={`${id}-face`}>Card face</label><select id={`${id}-face`} value={face} onChange={event => onChange({ face: event.target.value as CardFace, back })}><option value="classic">Classic</option><option value="large-index">Large index</option></select></div>
      <div><label htmlFor={`${id}-back`}>Card back</label><select id={`${id}-back`} value={back} onChange={event => onChange({ face, back: event.target.value as CardBack })}><option value="traditional">Traditional</option><option value="geometric">Geometric</option>{back!=='traditional'&&back!=='geometric'&&<option value={back}>{COSMETICS.find(c=>c.category==='back'&&c.id===back)?.name}</option>}</select></div>
    </div>
  </div>;
}
export function CardStylePicker({ face, back, onChange }: CardStyleProps) {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} aria-label="Card styles" title="Card styles" onClick={() => dialog.current?.showModal()}>▧ <span className={s.themeText}>Cards</span></button>
    <dialog ref={dialog} className={`${s.dialog} ${s.cardStyles}`} aria-labelledby="card-styles-title" onClose={() => {
      if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) trigger.current?.focus();
    }}>
      <div className={s.dialogHeading}><h2 id="card-styles-title">Your card styles</h2><button autoFocus aria-label="Close card styles" onClick={() => dialog.current?.close()}>✕</button></div>
      <p>Choose your own look. Saved in this browser for your next visit.</p>
      <CardStyleFields face={face} back={back} onChange={onChange} />
      <p>Your hand timer keeps running while you choose.</p>
    </dialog>
  </>;
}

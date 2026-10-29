import { useRef } from 'react';
import { PlayingCard } from './PlayingCard';
import type { CardBack, CardFace } from './cardAppearance';
import s from './App.module.css';
export function CardStylePicker({ face, back, onChange }: { face: CardFace; back: CardBack; onChange: (value: { face: CardFace; back: CardBack }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} aria-label="Card styles" title="Card styles" onClick={() => dialog.current?.showModal()}>▧ <span className={s.themeText}>Cards</span></button>
    <dialog ref={dialog} className={`${s.dialog} ${s.cardStyles}`} aria-labelledby="card-styles-title" onClose={() => {
      if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) trigger.current?.focus();
    }}>
      <div className={s.dialogHeading}><h2 id="card-styles-title">Your card styles</h2><button autoFocus aria-label="Close card styles" onClick={() => dialog.current?.close()}>✕</button></div>
      <p>Choose your own look. Saved in this browser for your next visit.</p>
      <div className={s.stylePreview}><PlayingCard card={{ id: 'preview', rank: 'A', suit: 'hearts' }} reducedMotion /><PlayingCard card={{ hidden: true }} reducedMotion /></div>
      <label htmlFor="card-face-style">Card face</label><select id="card-face-style" value={face} onChange={event => onChange({ face: event.target.value as CardFace, back })}><option value="classic">Classic</option><option value="large-index">Large index</option></select>
      <label htmlFor="card-back-style">Card back</label><select id="card-back-style" value={back} onChange={event => onChange({ face, back: event.target.value as CardBack })}><option value="traditional">Traditional</option><option value="geometric">Geometric</option></select>
      <p>Your hand timer keeps running while you choose.</p>
    </dialog>
  </>;
}

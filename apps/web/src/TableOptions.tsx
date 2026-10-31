import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CardBack, CardFace } from './cardAppearance';
import { CardStyleFields } from './CardStylePicker';
import s from './TableOptions.module.css';

type View = 'menu' | 'rules' | 'cards' | 'themes';
type Theme = 'classic' | 'midnight';
type Props = {
  appearance: { face: CardFace; back: CardBack };
  onAppearanceChange(next: { face: CardFace; back: CardBack }): void;
  theme: Theme;
  onThemeChange(next: Theme): void;
  rules: ReactNode;
};

export function TableOptions({ appearance, onAppearanceChange, theme, onThemeChange, rules }: Props) {
  const id = useId(); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const menuButtons = useRef<Partial<Record<Exclude<View, 'menu'>, HTMLButtonElement | null>>>({});
  const lastView = useRef<Exclude<View, 'menu'>>('rules');
  const [view, setView] = useState<View>('menu');
  useLayoutEffect(() => {
    if (!dialog.current?.open) return;
    if (view === 'menu') menuButtons.current[lastView.current]?.focus(); else title.current?.focus();
  }, [view]);
  function open() {
    setView('menu'); dialog.current?.showModal(); menuButtons.current.rules?.focus();
  }
  function visit(next: Exclude<View, 'menu'>) { lastView.current = next; setView(next); }
  function close() { dialog.current?.close(); }
  const currentFace = appearance.face === 'classic' ? 'Classic' : 'Large index';
  const currentBack = appearance.back === 'traditional' ? 'Traditional' : 'Geometric';
  return <>
    <button className={s.trigger} ref={trigger} type="button" aria-label="Table options" aria-haspopup="dialog" aria-controls={`${id}-dialog`} onClick={open}>Options</button>
    <dialog ref={dialog} id={`${id}-dialog`} className={s.dialog} aria-label="Table options" onClose={() => {
      setView('menu');
      if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) trigger.current?.focus();
    }}>
      <header className={s.header}>
        {view !== 'menu' && <button className={s.back} type="button" aria-label="Back to table options" onClick={() => setView('menu')}><span aria-hidden="true">←</span> Back</button>}
        <h2 ref={title} tabIndex={-1}>{view === 'menu' ? 'Table options' : view === 'rules' ? 'Rules' : view === 'cards' ? 'Card styles' : 'Table themes'}</h2>
        <button className={s.close} type="button" aria-label="Close table options" onClick={close}>×</button>
      </header>
      <div className={s.body}>
        {view === 'menu' && <div className={s.menu}>
          <p className={s.intro}>The rules of the table, and a look of your own.</p>
          <button ref={node => { menuButtons.current.rules = node; }} className={s.menuItem} type="button" aria-label="Rules" aria-describedby={`${id}-rules-detail`} onClick={() => visit('rules')}>
            <span className={s.menuIcon} aria-hidden="true">♣</span><span><strong>Rules</strong><small id={`${id}-rules-detail`}>Six decks · Dealer stands on 17</small></span><span className={s.chevron} aria-hidden="true">›</span>
          </button>
          <button ref={node => { menuButtons.current.cards = node; }} className={s.menuItem} type="button" aria-label="Cards" aria-describedby={`${id}-cards-detail`} onClick={() => visit('cards')}>
            <span className={s.menuIcon} aria-hidden="true">♠</span><span><strong>Cards</strong><small id={`${id}-cards-detail`}>{currentFace} faces · {currentBack} backs</small></span><span className={s.chevron} aria-hidden="true">›</span>
          </button>
          <button ref={node => { menuButtons.current.themes = node; }} className={s.menuItem} type="button" aria-label="Themes" aria-describedby={`${id}-themes-detail`} onClick={() => visit('themes')}>
            <span className={`${s.menuIcon} ${s.themeIcon}`} data-theme={theme} aria-hidden="true">◐</span><span><strong>Themes</strong><small id={`${id}-themes-detail`}>{theme === 'classic' ? 'Classic green' : 'Midnight blue'}</small></span><span className={s.chevron} aria-hidden="true">›</span>
          </button>
        </div>}
        {view === 'rules' && <div className={s.rules}>{rules}</div>}
        {view === 'cards' && <div className={s.cards}>
          <p className={s.intro}>Choose your card faces and backs. Only your view changes.</p>
          <CardStyleFields face={appearance.face} back={appearance.back} onChange={onAppearanceChange} />
        </div>}
        {view === 'themes' && <fieldset className={s.themes}>
          <legend>Table theme</legend>
          <p className={s.intro}>Choose the felt and colours for your table view.</p>
          {(['classic', 'midnight'] as const).map(value => <label className={s.themeChoice} data-selected={theme === value} key={value}>
            <input type="radio" name={`${id}-theme`} value={value} aria-label={value === 'classic' ? 'Classic' : 'Midnight'} aria-describedby={`${id}-${value}-description`} checked={theme === value} onChange={() => onThemeChange(value)} />
            <span className={s.swatch} data-theme={value} aria-hidden="true"><span>♣</span></span>
            <span className={s.themeCopy}><strong>{value === 'classic' ? 'Classic' : 'Midnight'}</strong><small id={`${id}-${value}-description`}>{value === 'classic' ? 'Green felt · Warm brass' : 'Blue felt · Cool silver'}</small></span>
            {theme === value && <span className={s.selected}>Selected</span>}
          </label>)}
        </fieldset>}
      </div>
      <footer className={s.footer}><span>Saved in this browser.</span><span>Your hand timer keeps running.</span></footer>
    </dialog>
  </>;
}

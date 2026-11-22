import s from './BettingChips.module.css';

const denominations = [10, 100, 1000] as const;
export type ChipDenomination = typeof denominations[number];

export function ChipButtons({ label = 'Choose a chip', className, selected, isDisabled, onChip }: {
  label?: string;
  className?: string;
  selected?: ChipDenomination;
  isDisabled(value: ChipDenomination): boolean;
  onChip(value: ChipDenomination): void;
}) {
  return <div className={className ? `${s.denominations} ${className}` : s.denominations} role="group" aria-label={label}>
    {denominations.map(value => {
      const amount = value.toLocaleString('en');
      return <button key={value} type="button" className={s.chipButton} aria-label={`${selected === undefined ? 'Add' : 'Select'} ${amount} chips`}
        aria-pressed={selected === undefined ? undefined : selected === value} disabled={isDisabled(value)} onClick={() => onChip(value)}>
        <span className={s.chipArt} data-value={value} aria-hidden="true">
          <svg viewBox="0 0 56 56">
            <circle className={s.chipEdge} cx="28" cy="27" r="24"/>
            <circle className={s.chipMarks} cx="28" cy="27" r="20.5"/>
            <circle className={s.chipFace} cx="28" cy="27" r="16.5"/>
            <text x="28" y="31" textAnchor="middle">{amount}</text>
          </svg>
        </span>
        {selected === value && <span className={s.selectedMark} aria-hidden="true">✓</span>}
      </button>;
    })}
  </div>;
}

export function ChipTray({ denomination, enabled, pending, canUndo, canClear, onSelect, onUndo, onClear }: {
  denomination: ChipDenomination;
  enabled: boolean;
  pending: boolean;
  canUndo: boolean;
  canClear: boolean;
  onSelect(value: ChipDenomination): void;
  onUndo(): void;
  onClear(): void;
}) {
  return <div className={s.tray} data-pending={pending}>
    <ChipButtons selected={denomination} isDisabled={() => !enabled} onChip={onSelect}/>
    <div className={s.edits}>
      <button type="button" disabled={!enabled || !canUndo} onClick={onUndo}><span aria-hidden="true">↶</span> Undo</button>
      <button type="button" aria-label="Clear bets" disabled={!enabled || !canClear} onClick={onClear}>Clear<span className={s.clearSuffix}> bets</span></button>
    </div>
  </div>;
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** A dropdown option shows ` ▾` after its label. */
  dropdown?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** The smaller variant used inside a card. */
  compact?: boolean;
}

/** Square-cornered segmented buttons: the selected one navy, the rest white. */
export default function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, compact }: SegmentedControlProps<T>) {
  return (
    <div className={compact ? "seg seg-compact" : "seg"} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg-btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.dropdown ? " ▾" : ""}
        </button>
      ))}
    </div>
  );
}

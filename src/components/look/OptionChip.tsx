export function OptionChip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
        selected
          ? "border-foreground bg-foreground text-primary-foreground"
          : "border-border bg-surface text-foreground/80 hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

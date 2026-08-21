export function ExamplePrompt({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (label: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(label)}
      className="shrink-0 rounded-full border border-border bg-surface px-4 py-2 text-[13px] text-foreground/80 hover:border-foreground/30 hover:text-foreground transition-colors whitespace-nowrap"
    >
      {label}
    </button>
  );
}

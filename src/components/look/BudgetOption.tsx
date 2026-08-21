import { Check } from "lucide-react";

export function BudgetOption({
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
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-colors ${
        selected
          ? "border-foreground/25 bg-foreground text-primary-foreground"
          : "border-border bg-surface text-foreground hover:border-foreground/25"
      }`}
    >
      <span className="text-[14px] font-medium">{label}</span>
      {selected && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground text-foreground">
          <Check size={12} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
}

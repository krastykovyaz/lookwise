import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface border border-border text-muted">
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-[15px] font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1.5 text-[13px] text-muted max-w-[26ch]">{hint}</p>}
    </div>
  );
}

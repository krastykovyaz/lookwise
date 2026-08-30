import type { ReactNode } from "react";

type BadgeTone = "neutral" | "positive" | "warning";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-background text-foreground/70 border border-border",
  positive: "bg-positive-bg text-positive",
  warning: "bg-warning-bg text-warning",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

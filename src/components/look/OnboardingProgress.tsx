export function OnboardingProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i < step ? "bg-foreground" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

import {
  Dumbbell,
  Footprints,
  History,
  Minus,
  Shirt,
  Sparkles,
  Watch,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Check } from "lucide-react";
import type { StyleArchetypeId } from "@/types/style";

// One icon per archetype — a lightweight visual stand-in until the
// real fashion photography referenced in the spec ("use image-based
// visual cards") is available. Keeps the onboarding fully functional
// without depending on stock imagery.
const ARCHETYPE_ICONS: Record<StyleArchetypeId, LucideIcon> = {
  minimalist: Minus,
  street: Footprints,
  smart_casual: Shirt,
  classic: Watch,
  vintage: History,
  functional: Wrench,
  sporty: Dumbbell,
  experimental: Sparkles,
};

export function StyleArchetypeCard({
  id,
  label,
  description,
  selected,
  onToggle,
}: {
  id: StyleArchetypeId;
  label: string;
  description: string;
  selected: boolean;
  onToggle: (id: StyleArchetypeId) => void;
}) {
  const Icon = ARCHETYPE_ICONS[id];

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={() => onToggle(id)}
      className={`relative flex flex-col items-start gap-2.5 rounded-2xl border p-4 text-left transition-colors ${
        selected
          ? "border-foreground/25 bg-foreground text-primary-foreground"
          : "border-border bg-surface text-foreground hover:border-foreground/25"
      }`}
    >
      {selected && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground text-foreground">
          <Check size={12} strokeWidth={2.5} />
        </span>
      )}
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full ${
          selected ? "bg-white/15" : "bg-background"
        }`}
      >
        <Icon size={17} strokeWidth={1.75} />
      </span>
      <span>
        <span className="block text-[14px] font-medium">{label}</span>
        <span
          className={`mt-0.5 block text-[12px] leading-4 ${
            selected ? "text-primary-foreground/70" : "text-muted"
          }`}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

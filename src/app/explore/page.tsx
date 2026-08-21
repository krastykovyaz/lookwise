"use client";

import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ExploreFeed } from "@/components/explore/ExploreFeed";

export default function ExplorePage() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col pt-6">
      <div className="flex items-center gap-2 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-primary-foreground">
          <Sparkles size={14} strokeWidth={1.75} />
        </span>
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-foreground">{t("explore.title")}</h1>
          <p className="text-[12px] text-muted">{t("explore.subtitle")}</p>
        </div>
      </div>
      <ExploreFeed />
    </div>
  );
}

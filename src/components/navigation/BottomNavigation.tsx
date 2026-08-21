"use client";

import { useNavigationState, type MainTab } from "@/lib/navigation/state";
import { Sparkles, Compass, Layers3, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const TABS = [
  { href: "/explore", icon: Sparkles, labelKey: "nav.explore" },
  { href: "/", icon: Compass, labelKey: "nav.search" },
  { href: "/overview", icon: Layers3, labelKey: "nav.overview" },
  { href: "/profile", icon: User, labelKey: "nav.profile" },
] as const;

export function BottomNavigation() {
  const { t } = useI18n();
  const { activeTab, returnPaths, switchTab } = useNavigationState();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-1/2 z-[100] w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-surface/95 px-2 pt-2 backdrop-blur-sm pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <ul className="flex items-center justify-between">
        {TABS.map(({ href, icon: Icon, labelKey }) => {
          const tab = href === "/explore"
            ? "explore"
            : href === "/"
              ? "search"
              : href === "/overview"
                ? "overview"
                : "profile";
          const active = activeTab === tab;
          const rememberedPath = returnPaths[tab as MainTab] || href;

          return (
            <li key={href} className="flex-1">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={t(labelKey)}
                onClick={() => switchTab(tab as MainTab)}
                className="w-full flex flex-col items-center gap-1 rounded-xl py-1.5"
                data-return-path={rememberedPath}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted"
                  }`}
                >
                  <Icon
                    size={17}
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                </span>

                <span
                  className={`text-[11px] leading-none ${
                    active
                      ? "font-medium text-foreground"
                      : "text-muted"
                  }`}
                >
                  {t(labelKey)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

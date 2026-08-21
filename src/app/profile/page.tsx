"use client";

import { User, DollarSign, Bell, Crown, Info, LogOut, ChevronRight } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/ui/LanguageSelector";
import { CurrencySelector } from "@/components/ui/CurrencySelector";
import { LookProfileSummary } from "@/components/look/LookProfileSummary";
import { NotificationsBadge } from "@/components/profile/NotificationsBadge";
import { SubscriptionBadge } from "@/components/profile/SubscriptionBadge";
import Link from "next/link";

function Row({
  icon: Icon,
  label,
  trailing,
  href,
}: {
  icon: React.ElementType;
  label: string;
  trailing: React.ReactNode;
  /** Optional: makes the whole row a nested-navigation link (e.g.
   *  Profile -> Notifications) instead of a static settings row. */
  href?: string;
}) {
  const content = (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-muted">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <span className="text-[14px] text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {trailing}
        {href && <ChevronRight size={16} strokeWidth={1.75} className="text-muted-soft" />}
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block hover:bg-background/60 transition-colors">
      {content}
    </Link>
  );
}

export default function ProfilePage() {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.user;

  return (
    <div className="px-5 pt-6">
      <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
        {t("profile.title")}
      </h1>

      <div className="mt-5 flex items-center justify-between gap-3.5">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface border border-border text-muted overflow-hidden">
            {isAuthenticated && session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <User size={26} strokeWidth={1.5} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[16px] font-medium text-foreground truncate">
              {isAuthenticated ? session.user.name ?? session.user.email : t("profile.guestName")}
            </p>
            {isAuthenticated ? (
              <p className="text-[12.5px] text-muted truncate">{session.user.email}</p>
            ) : (
              <p className="text-[12.5px] text-muted">{t("profile.guestHint")}</p>
            )}
          </div>
        </div>
        {isAuthenticated ? (
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/profile" })}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-[12.5px] font-medium text-foreground"
          >
            <LogOut size={14} strokeWidth={1.75} />
            {t("auth.signOut")}
          </button>
        ) : (
          <Link
            href="/login"
            className="shrink-0 rounded-full bg-foreground px-4 py-2 text-[12.5px] font-medium text-background"
          >
            {t("auth.signIn")}
          </Link>
        )}
      </div>

      <p className="mt-7 px-1 text-[12px] font-medium text-muted uppercase tracking-wide">
        {t("look.sectionTitle")}
      </p>
      <LookProfileSummary />

      <p className="mt-7 px-1 text-[12px] font-medium text-muted uppercase tracking-wide">
        {t("profile.sectionPreferences")}
      </p>
      <div className="mt-2 rounded-2xl border border-border bg-surface divide-y divide-border overflow-hidden">
        <Row icon={Info} label={t("profile.language")} trailing={<LanguageSelector />} />
        <Row
          icon={DollarSign}
          label={t("profile.currency")}
          trailing={<CurrencySelector />}
        />
        <Row
          icon={Bell}
          label={t("profile.notifications")}
          href={isAuthenticated ? "/profile/notifications" : undefined}
          trailing={
            isAuthenticated ? (
              <NotificationsBadge />
            ) : (
              <span className="text-[12px] text-muted-soft">{t("common.comingSoon")}</span>
            )
          }
        />
        <Row
          icon={Crown}
          label={t("profile.subscription")}
          href={isAuthenticated ? "/profile/subscription" : undefined}
          trailing={isAuthenticated ? <SubscriptionBadge /> : null}
        />
      </div>

      <p className="mt-7 px-1 text-[12px] font-medium text-muted uppercase tracking-wide">
        {t("profile.sectionAbout")}
      </p>
      <div className="mt-2 rounded-2xl border border-border bg-surface p-4">
        <p className="text-[13.5px] font-medium text-foreground">
          {t("profile.about")}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted leading-5">
          {t("profile.aboutBody")}
        </p>
        <p className="mt-3 text-[11.5px] text-muted-soft">
          {t("profile.version")} 0.1.0 · Milestone 0
        </p>
      </div>
    </div>
  );
}

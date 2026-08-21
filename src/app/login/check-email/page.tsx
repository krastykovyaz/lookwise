"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";

export default function CheckEmailPage() {
  const { t } = useI18n();
  return (
    <div className="px-5 pt-10">
      <EmptyState icon={MailCheck} title={t("auth.checkEmailTitle")} hint={t("auth.checkEmailBody")} />
      <div className="flex justify-center">
        <Link href="/login" className="text-[13.5px] font-medium text-foreground underline underline-offset-4">
          {t("auth.backToSignIn")}
        </Link>
      </div>
    </div>
  );
}

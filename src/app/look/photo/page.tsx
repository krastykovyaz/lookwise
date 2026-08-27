"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Camera, ImageUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PhotoAnalysis } from "@/lib/schemas";

type Status = "idle" | "analyzing" | "error";

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// data:image/jpeg;base64,<payload> -> { mimeType, base64 }. Only ever
// called on a string this same file just produced via readAsDataURL.
function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export default function BuildFromPhotoPage() {
  const { t } = useI18n();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<PhotoAnalysis | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setStatus("error");
      setResult(null);
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setPreviewUrl(dataUrl);
    setResult(null);
    setStatus("idle");
  };

  const handleAnalyze = async () => {
    if (!previewUrl || status === "analyzing") return;
    const parts = splitDataUrl(previewUrl);
    if (!parts) {
      setStatus("error");
      return;
    }

    setStatus("analyzing");
    try {
      const res = await fetch("/api/look/photo-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: parts.base64, mimeType: parts.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setResult(data.analysis as PhotoAnalysis);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const itemGroups: { label: string; items: PhotoAnalysis["items"] }[] = result
    ? [
        { label: t("look.photo.itemsLabel"), items: result.items },
        { label: t("look.photo.shoesLabel"), items: result.shoes },
        { label: t("look.photo.accessoriesLabel"), items: result.accessories },
      ]
    : [];
  const hasAnyRecognized =
    result != null &&
    (result.items.length > 0 || result.shoes.length > 0 || result.accessories.length > 0);

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center bg-background/90 backdrop-blur-sm px-3 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={t("common.back")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-border text-foreground"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="px-5">
        <h1 className="text-[21px] font-semibold tracking-tight text-foreground leading-snug">
          {t("look.photo.title")}
        </h1>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MIME_TYPES.join(",")}
          className="hidden"
          onChange={handleFileChange}
        />

        {previewUrl ? (
          <div className="mt-5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a locally-selected data: URL, next/image's remote loader doesn't apply */}
            <img
              src={previewUrl}
              alt=""
              className="w-full max-h-[420px] rounded-2xl border border-border object-cover"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2"
            >
              {t("look.photo.changePhoto")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-5 flex w-full flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-foreground">
              <ImageUp size={20} strokeWidth={1.75} />
            </span>
            <span className="text-[13.5px] font-medium text-foreground">
              {t("look.photo.uploadPrompt")}
            </span>
          </button>
        )}

        {previewUrl && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={status === "analyzing"}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-[14px] font-medium text-primary-foreground disabled:opacity-60"
          >
            <Camera size={16} strokeWidth={1.75} />
            {status === "analyzing" ? t("look.photo.analyzing") : t("look.photo.analyzeButton")}
          </button>
        )}

        {status === "error" && (
          <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted leading-5">
            {t("look.photo.errorGeneric")}
          </p>
        )}

        {result && (
          <div className="mt-6">
            <h2 className="text-[15px] font-semibold text-foreground">{t("look.photo.resultTitle")}</h2>

            {!hasAnyRecognized && (
              <p className="mt-2 text-[13px] text-muted">{t("look.photo.noItemsDetected")}</p>
            )}

            {itemGroups.map(
              (group) =>
                group.items.length > 0 && (
                  <div key={group.label} className="mt-4">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-muted">
                      {group.label}
                    </p>
                    <div className="mt-2 space-y-2">
                      {group.items.map((item, i) => (
                        <div
                          key={`${group.label}-${i}`}
                          className="rounded-2xl border border-border bg-surface px-4 py-3"
                        >
                          <p className="text-[13.5px] font-medium text-foreground capitalize">
                            {item.category}
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-muted">
                            {[item.color, item.style, item.fit].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
            )}

            {result.overallStyle.length > 0 && (
              <div className="mt-4">
                <p className="text-[12px] font-medium uppercase tracking-wide text-muted">
                  {t("look.photo.overallStyleLabel")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.overallStyle.map((style) => (
                    <span
                      key={style}
                      className="rounded-full bg-background px-2.5 py-1 text-[12px] font-medium text-foreground"
                    >
                      {style}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                router.push(`/look?photoDescription=${encodeURIComponent(result.description)}`)
              }
              className="mt-5 flex w-full items-center justify-center rounded-full bg-primary py-3.5 text-[14px] font-medium text-primary-foreground"
            >
              {t("look.photo.useDescription")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

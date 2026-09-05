"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, Mic, MicOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSpeechRecognition } from "@/lib/style/useSpeechRecognition";
import type { ProductPhotoAnalysis } from "@/lib/schemas";

interface AIInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// data:image/jpeg;base64,<payload> -> { mimeType, base64 }. Only ever
// called on a string this same helper just produced via readAsDataURL.
// Same helper as app/look/page.tsx's handlePhotoFile — not shared as a
// module since it's a two-line pure function, not worth a new file for.
function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export function AIInput({ value, onChange, onSubmit }: AIInputProps) {
  const { t, locale } = useI18n();
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Same "fill the field, never auto-submit" pipeline voice input
  // already uses just below (section 4 of that feature: "do not
  // create a separate search implementation") — the description
  // replaces the field's text so the user can review/edit it before
  // pressing send, same as anything else typed there. Mirrors
  // app/look/page.tsx's handlePhotoFile, just posting to
  // /api/buyer/photo-analyze (a single-item analysis) instead of
  // /api/look/photo-analyze (an outfit one) — see lib/ai/gemini.ts's
  // analyzeProductPhoto for why those are separate prompts/schemas
  // sharing the same underlying Gemini client.
  const handlePhotoFile = async (file: File | null | undefined) => {
    if (!file || photoStatus === "analyzing") return;
    if (!PHOTO_MIME_TYPES.includes(file.type)) {
      setPhotoStatus("error");
      return;
    }

    setPhotoStatus("analyzing");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const parts = splitDataUrl(dataUrl);
      if (!parts) {
        setPhotoStatus("error");
        return;
      }
      const res = await fetch("/api/buyer/photo-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: parts.base64, mimeType: parts.mimeType, locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhotoStatus("error");
        return;
      }
      onChange((data.analysis as ProductPhotoAnalysis).description);
      setPhotoStatus("idle");
    } catch {
      setPhotoStatus("error");
    }
  };

  const handleSubmit = () => {
    if (!value.trim()) {
      textareaRef.current?.focus();
      return;
    }
    onSubmit(value.trim());
  };

  // Voice input reuses the exact same onChange/onSubmit pipeline as
  // typed input (section 4: "do not create a separate search
  // implementation for voice") — recognized text is appended into the
  // existing textarea value, never submitted automatically, so the
  // person can review/edit it before pressing send just like typed
  // text.
  const { status: voiceStatus, isSupported: voiceSupported, toggle: toggleVoice } = useSpeechRecognition({
    onResult: (transcript) => {
      const current = valueRef.current.trim();
      onChange(current ? `${current} ${transcript}` : transcript);
    },
  });
  const isListening = voiceStatus === "listening";

  return (
    <div
      className={`rounded-[1.25rem] border bg-surface p-3 transition-shadow ${
        focused
          ? "border-foreground/25 shadow-[0_4px_20px_rgba(20,19,15,0.08)]"
          : "border-border shadow-[0_1px_2px_rgba(20,19,15,0.04)]"
      }`}
    >
      <input
        ref={photoInputRef}
        type="file"
        accept={PHOTO_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handlePhotoFile(file);
        }}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handlePhotoFile(e.dataTransfer.files?.[0]);
        }}
        placeholder={t("buyer.placeholder")}
        rows={2}
        disabled={photoStatus === "analyzing"}
        className="w-full resize-none bg-transparent text-[16px] leading-6 text-foreground placeholder:text-muted-soft outline-none disabled:opacity-60"
      />
      {photoStatus === "analyzing" && (
        <p className="mt-1 text-[12.5px] text-muted">{t("look.photo.analyzing")}</p>
      )}
      {photoStatus === "error" && (
        <p className="mt-1 text-[12.5px] text-muted">{t("look.photo.errorGeneric")}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            aria-label={isListening ? t("buyer.voiceStop") : t("buyer.voiceStart")}
            aria-pressed={isListening}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isListening
                ? "bg-red-500/10 text-red-500 animate-pulse"
                : "text-muted hover:text-foreground hover:bg-background"
            }`}
          >
            {isListening ? <MicOff size={18} strokeWidth={1.75} /> : <Mic size={18} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={photoStatus === "analyzing"}
            aria-label={t("buyer.attachPhoto")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Camera size={18} strokeWidth={1.75} />
          </button>
          {isListening && (
            <span className="text-[12px] text-muted">{t("buyer.voiceListening")}</span>
          )}
          {voiceStatus === "denied" && (
            <span className="text-[12px] text-red-500">{t("buyer.voiceDenied")}</span>
          )}
          {voiceStatus === "error" && (
            <span className="text-[12px] text-red-500">{t("buyer.voiceError")}</span>
          )}
          {voiceStatus === "unsupported" && (
            <span className="text-[12px] text-muted">{t("buyer.voiceUnsupported")}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
        >
          <ArrowUp size={18} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

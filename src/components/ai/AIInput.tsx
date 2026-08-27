"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSpeechRecognition } from "@/lib/style/useSpeechRecognition";

interface AIInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function AIInput({ value, onChange, onSubmit }: AIInputProps) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

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
        placeholder={t("buyer.placeholder")}
        rows={2}
        className="w-full resize-none bg-transparent text-[16px] leading-6 text-foreground placeholder:text-muted-soft outline-none"
      />
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

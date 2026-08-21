"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ExamplePrompt } from "@/components/ai/ExamplePrompt";
import type { Product } from "@/types/product";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
}

export function AskCompass({ product }: { product: Product }) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  const prompts = [
    t("ask.prompt1"),
    t("ask.prompt2"),
    t("ask.prompt3"),
    t("ask.prompt4"),
  ];

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: "user", text: trimmed }]);
    setDraft("");
    setPending(true);

    try {
      const response = await fetch("/api/buyer/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          locale,
          product: {
            title: product.title,
            price: product.price,
            currency: product.currency,
            condition: product.condition,
            brand: product.brand,
            color: product.color,
            seller: product.seller,
            location: product.location,
            shipping: product.shipping,
            returnPolicy: product.returnPolicy,
            dealScore: product.dealScore,
          },
        }),
      });
      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          text: response.ok ? data.answer : t("ask.error"),
          isError: !response.ok,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-a`, role: "assistant", text: t("ask.error"), isError: true },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="px-1">
        <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
          {t("ask.title")}
        </h2>
        <p className="mt-1 text-[13px] text-muted">{product.title}</p>
      </div>

      <div className="mt-5 flex flex-col gap-3 min-h-[120px]">
        {messages.length === 0 ? (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {prompts.map((p) => (
              <ExamplePrompt key={p} label={p} onSelect={send} />
            ))}
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-5 ${
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground rounded-br-sm"
                    : m.isError
                      ? "self-start bg-warning-bg text-warning rounded-bl-sm"
                      : "self-start bg-background border border-border text-foreground rounded-bl-sm"
                }`}
              >
                {m.text}
              </div>
            ))}
            {pending && (
              <div className="self-start rounded-2xl rounded-bl-sm bg-background border border-border px-4 py-2.5 text-[13px] text-muted animate-pulse">
                {t("ask.thinking")}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-full border border-border bg-surface pl-4 pr-1.5 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send(draft);
          }}
          placeholder={t("ask.placeholder")}
          className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-soft"
        />
        <button
          type="button"
          onClick={() => send(draft)}
          disabled={pending}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          <ArrowUp size={15} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

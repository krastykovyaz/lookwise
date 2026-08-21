"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechRecognition, SpeechRecognitionConstructor } from "@/types/speechRecognition";

export type VoiceInputStatus = "idle" | "listening" | "unsupported" | "denied" | "error";

interface UseSpeechRecognitionOptions {
  /** Called with the recognized text once a result is final. */
  onResult: (transcript: string) => void;
  lang?: string;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  // Guarded so this never runs during SSR (window doesn't exist there)
  // and never throws on browsers that simply don't implement either
  // name (section 4: "do not crash SSR", "handle unsupported browsers
  // gracefully").
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** Browser-native speech-to-text (no dependency, no audio ever sent to
 *  our backend — recognition and audio capture both happen inside the
 *  browser). One recognizer instance per hook instance; start() is a
 *  no-op while already listening so rapid double-clicks on the mic
 *  button can't spin up a second handler, and everything is torn down
 *  on unmount. */
export function useSpeechRecognition({ onResult, lang = "en-US" }: UseSpeechRecognitionOptions) {
  // Starts as "idle" unconditionally — same value on the server and
  // during the client's initial (pre-hydration) render, since neither
  // one may access `window` to determine real support yet. Actual
  // support detection happens in the effect below, which only ever
  // runs client-side after hydration completes, so this never causes
  // a server/client markup mismatch (a lazy useState initializer that
  // branched on `typeof window` here previously did exactly that —
  // see the hydration-mismatch report this was fixed from).
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!getSpeechRecognitionCtor()) setStatus("unsupported");
  }, []);

  const isSupported = status !== "unsupported";

  useEffect(() => {
    // Clean up recognition on unmount (section 4) — stop() first so
    // the browser's mic indicator turns off, then drop all handlers
    // to guard against a result/error event firing after unmount.
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.stop();
        } catch {
          // Already stopped/never started — fine to ignore.

        }
      }
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (status === "listening") return; // prevent duplicate handlers
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results.item(i).item(0).transcript)
        .join(" ")
        .trim();
      if (transcript) onResultRef.current(transcript);
    };

    recognition.onerror = (event) => {
      // "not-allowed"/"permission-denied" -> the user (or the OS)
      // declined mic access; everything else is treated as a generic,
      // recoverable error (section 4: "handle microphone permission
      // errors gracefully").
      setStatus(event.error === "not-allowed" || event.error === "permission-denied" ? "denied" : "error");
    };

    recognition.onend = () => {
      setStatus((current) => (current === "listening" ? "idle" : current));
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStatus("listening");
    } catch {
      setStatus("error");
    }
  }, [status, lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (status === "listening") stop();
    else start();
  }, [status, start, stop]);

  return { status, isSupported, start, stop, toggle };
}

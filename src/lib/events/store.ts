"use client";

import type { PreferenceEvent, PreferenceEventType } from "@/types/events";

const STORAGE_KEY = "compass.events";
const MAX_EVENTS = 300;

// The abstraction the rest of the app talks to. Today there's only a
// localStorage sink (section 5: "Keep this client-side/localStorage for
// now"); swapping in a real backend later means adding a RemoteEventSink
// here and changing one export, not touching any call site.
export interface EventSink {
  record(event: PreferenceEvent): void;
  list(): PreferenceEvent[];
}

class LocalStorageEventSink implements EventSink {
  private read(): PreferenceEvent[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as PreferenceEvent[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(events: PreferenceEvent[]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch {
      // Storage full/unavailable — events stay in-memory for this tab only.
    }
  }

  record(event: PreferenceEvent) {
    const next = [...this.read(), event].slice(-MAX_EVENTS);
    this.write(next);
  }

  list(): PreferenceEvent[] {
    return this.read();
  }
}

// Not wired up — kept here so the future move to a real backend
// (section 5: "create the abstraction so it can later be replaced with
// POST /api/events without changing the UI") is a one-line swap of
// `eventSink` below, not a rewrite of every call site.
//
// class RemoteEventSink implements EventSink {
//   record(event: PreferenceEvent) {
//     void fetch("/api/events", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(event),
//     });
//   }
//   list(): PreferenceEvent[] { return []; }
// }

export const eventSink: EventSink = new LocalStorageEventSink();

function createEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordEvent(input: Omit<PreferenceEvent, "id" | "timestamp">): PreferenceEvent {
  const event: PreferenceEvent = {
    ...input,
    id: createEventId(),
    timestamp: new Date().toISOString(),
  };
  eventSink.record(event);
  return event;
}

export function readEvents(): PreferenceEvent[] {
  return eventSink.list();
}

// Event types that should also count as impressions when checking
// "has this been shown before" — kept here since it's a one-liner used
// in a couple of places.
export function isInteractionEvent(type: PreferenceEventType): boolean {
  return type !== "impression" && type !== "view";
}

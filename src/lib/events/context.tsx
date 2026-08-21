"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { PreferenceEvent } from "@/types/events";
import type { BehavioralPreferences } from "@/types/events";
import { readEvents, recordEvent as recordEventToSink } from "@/lib/events/store";
import { deriveBehavioralPreferences } from "@/lib/events/behavioral";
import { syncEvent } from "@/lib/db/clientSync";

interface EventsContextValue {
  events: PreferenceEvent[];
  isLoaded: boolean;
  behavioral: BehavioralPreferences;
  record: (input: Omit<PreferenceEvent, "id" | "timestamp">) => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<PreferenceEvent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const { status } = useSession();

  useEffect(() => {
    setEvents(readEvents());
    setIsLoaded(true);
  }, []);

  const record = useCallback(
    (input: Omit<PreferenceEvent, "id" | "timestamp">) => {
      const event = recordEventToSink(input);
      setEvents((current) => [...current, event]);
      if (status === "authenticated") syncEvent(event);
    },
    [status],
  );

  const behavioral = useMemo(() => deriveBehavioralPreferences(events), [events]);

  const value = useMemo(
    () => ({ events, isLoaded, behavioral, record }),
    [events, isLoaded, behavioral, record],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents() {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useEvents must be used within EventsProvider");
  return ctx;
}

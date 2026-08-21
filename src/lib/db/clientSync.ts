"use client";

import type { PreferenceEvent } from "@/types/events";
import type { Product } from "@/types/product";
import type { GeneratedLook } from "@/types/style";

// Thin fire-and-forget mirrors of the local providers' write actions
// into the persistence API (section 6: "Do not remove the current
// client-side event system; add persistence behind it"). Every
// function here is a no-op-safe best-effort POST — failures are
// swallowed because local state (already updated by the caller) stays
// the source of truth for the current tab regardless of network
// hiccups; the DB copy is a mirror, not the primary write path.

async function post(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort — local state already reflects the change.
  }
}

async function del(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {}
}

// Product/look payloads are trimmed to what the server's
// ProductSnapshotSchema/LookSnapshotSchema actually validate (see
// lib/schemas.ts) rather than sent as-is — smaller request bodies,
// and it keeps the wire shape explicit here instead of implicitly
// relying on the full client Product/GeneratedLook type never
// changing shape underneath these calls.

function productSnapshot(product: Product) {
  return {
    id: product.id,
    title: product.title,
    price: product.price,
    currency: product.currency,
    image: product.image,
    condition: product.condition,
    brand: product.brand,
    category: product.category,
    seller: product.seller,
    availability: product.availability,
    itemWebUrl: product.itemWebUrl,
  };
}

// Exported so the Share flow (components/share/ShareButton usage in
// look/page.tsx) can build the same wire payload to POST to
// /api/look/share without duplicating this trimming logic.
export function lookSnapshot(look: GeneratedLook) {
  return {
    title: look.title,
    description: look.description ?? null,
    components: look.components.map((c) => ({
      role: c.role,
      product: c.product ? productSnapshot(c.product) : null,
    })),
  };
}

export function syncViewedProduct(product: Product, provider = "ebay") {
  void post("/api/activity/viewed", { product: productSnapshot(product), provider });
}

export function syncSaveProduct(product: Product) {
  void post("/api/activity/saved-products", { product: productSnapshot(product) });
}

export function syncUnsaveProduct(productId: string) {
  void del("/api/activity/saved-products", { productId });
}

export function syncSaveLook(lookId: string, look: GeneratedLook) {
  void post("/api/activity/saved-looks", { lookId, look: lookSnapshot(look) });
}

export function syncUnsaveLook(lookId: string) {
  void del("/api/activity/saved-looks", { lookId });
}

export function syncViewedLook(lookId: string, look: GeneratedLook) {
  void post("/api/activity/viewed-looks", { lookId, look: lookSnapshot(look) });
}

export function syncSignal(input: { productId?: string; lookId?: string; signalType: "like" | "dislike" }) {
  void post("/api/activity/signals", input);
}

export function syncEvent(event: PreferenceEvent) {
  void post("/api/activity/events", event);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { mergeAnonymousState } from "@/lib/db/repositories/merge";
import { BUDGET_RANGES, STYLE_ARCHETYPES } from "@/types/style";
import type { UserStyleProfile } from "@/types/style";
import { ProductSnapshotSchema, LookSnapshotSchema } from "@/lib/schemas";
import { productSnapshotToProduct, lookSnapshotToComponents } from "@/lib/db/repositories/reconstruct";

const locationSchema = z
  .object({
    city: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    timezone: z.string().nullable(),
    source: z.enum(["geolocation", "manual"]),
  })
  .nullable();

const profileSchema = z.object({
  styleArchetypes: z.array(z.enum(STYLE_ARCHETYPES as [string, ...string[]])),
  preferredFit: z.string().nullable(),
  preferredColors: z.array(z.string()),
  dislikedColors: z.array(z.string()),
  preferredBrands: z.array(z.string()),
  dislikedBrands: z.array(z.string()),
  budgetRange: z.enum(BUDGET_RANGES as [string, ...string[]]).nullable(),
  location: locationSchema,
  favoriteCategories: z.array(z.string()),
  dislikedCategories: z.array(z.string()),
  profileCompleteness: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const savedLookEntrySchema = z.object({ lookId: z.string().min(1), look: LookSnapshotSchema });

const bodySchema = z.object({
  profile: profileSchema.nullable().optional(),
  viewedProducts: z.array(ProductSnapshotSchema).max(500).optional(),
  savedProducts: z.array(ProductSnapshotSchema).max(500).optional(),
  savedLooks: z.array(savedLookEntrySchema).max(200).optional(),
  viewedLooks: z.array(savedLookEntrySchema).max(500).optional(),
  likedProductIds: z.array(z.string()).optional(),
  dislikedProductIds: z.array(z.string()).optional(),
  events: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        timestamp: z.string(),
        productId: z.string().nullable().optional(),
        lookId: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        brand: z.string().nullable().optional(),
        price: z.number().nullable().optional(),
        source: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
      }),
    )
    .optional(),
});

// Called once, client-side, immediately after a successful sign-in —
// see components/auth/MergeOnSignIn.tsx. Idempotent: every write
// underneath is either a unique-constrained upsert or a plain insert
// into an append-only log, so calling this twice (e.g. a retried
// request) never double-applies anything harmful beyond a duplicate
// event/signal row (or an extra orphaned look snapshot — see
// saveLook/recordViewedLook — which is harmless cache data, not a
// user-visible duplicate), which the recommendation/behavioral layers
// already tolerate (section 10).
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const toComponents = (look: z.infer<typeof LookSnapshotSchema>) => ({
    title: look.title,
    description: look.description,
    components: lookSnapshotToComponents(look),
  });

  const summary = await mergeAnonymousState(userId, {
    profile: (parsed.data.profile as UserStyleProfile | null) ?? null,
    viewedProducts: parsed.data.viewedProducts?.map(productSnapshotToProduct),
    savedProducts: parsed.data.savedProducts?.map(productSnapshotToProduct),
    savedLooks: parsed.data.savedLooks?.map((e) => ({ lookId: e.lookId, look: toComponents(e.look) })),
    viewedLooks: parsed.data.viewedLooks?.map((e) => ({ lookId: e.lookId, look: toComponents(e.look) })),
    likedProductIds: parsed.data.likedProductIds,
    dislikedProductIds: parsed.data.dislikedProductIds,
    events: parsed.data.events as never,
  });

  return NextResponse.json({ ok: true, summary });
}

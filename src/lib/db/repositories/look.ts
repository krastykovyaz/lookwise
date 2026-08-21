import "server-only";
import { db, schema } from "@/lib/db/client";
import { upsertProduct } from "@/lib/db/repositories/product";
import { loadLooksByRowId } from "@/lib/db/repositories/reconstruct";
import type { Product } from "@/types/product";
import type { GeneratedLook } from "@/types/style";

export interface LookComponentInput {
  product: Product | null;
  role: string;
}

/** Persists a generated look. Components with a null product (no real
 *  item returned by the provider — see selectConsistentComponents in
 *  lib/look) are skipped entirely, matching section 7's rule that a
 *  look must never reference a nonexistent product. A look with zero
 *  persistable components still gets a Look row (title/description
 *  are meaningful on their own) but no LookProduct rows. */
export async function createLook(input: {
  userId: string | null;
  title: string;
  description?: string | null;
  language?: string | null;
  gender?: string | null;
  provider: string;
  components: LookComponentInput[];
}) {
  const [look] = await db
    .insert(schema.looks)
    .values({
      userId: input.userId,
      title: input.title,
      description: input.description ?? null,
      language: input.language ?? null,
      gender: input.gender ?? null,
    })
    .returning();

  let position = 0;
  for (const component of input.components) {
    if (!component.product) continue; // never insert a fake/nonexistent product
    const productRow = await upsertProduct(input.provider, component.product);
    if (!productRow) continue;
    await db.insert(schema.lookProducts).values({
      lookId: look.id,
      productId: productRow.id,
      position: position++,
      role: component.role,
    });
  }

  return look;
}

/** Public read for the shareable /look/[lookId] page and its OG
 *  metadata (see app/look/[lookId]/page.tsx). Deliberately NOT scoped
 *  to a userId — a look's permanent snapshot (looks/lookProducts/
 *  products rows) is public content once shared, same as an eBay
 *  listing page. Returns null for an unknown id or a look with no
 *  reconstructable components, so the caller can 404 either way. */
export async function getPublicLook(lookId: string): Promise<GeneratedLook | null> {
  const looksById = await loadLooksByRowId([lookId]);
  return looksById.get(lookId) ?? null;
}

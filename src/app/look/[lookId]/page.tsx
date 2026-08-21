import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicLook } from "@/lib/db/repositories/look";
import { absoluteUrl } from "@/lib/url";
import { formatOgPrice } from "@/lib/og";
import { PublicLookView } from "@/components/look/PublicLookView";

export const runtime = "nodejs";

// Section 21: public Look pages are meant to be indexed, so this
// intentionally does NOT set noindex — only the app's private/
// authenticated pages should stay out of search results, and this
// route never touches those.

interface PageParams {
  lookId: string;
}

function describeLook(look: NonNullable<Awaited<ReturnType<typeof getPublicLook>>>): string {
  const itemCount = look.components.filter((c) => c.product).length;
  const parts: string[] = [];
  if (itemCount > 0) parts.push(`${itemCount} item${itemCount === 1 ? "" : "s"}`);
  if (look.totalPrice != null) parts.push(formatOgPrice(look.totalPrice, look.currency));
  return parts.length > 0 ? parts.join(" · ") : look.title;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { lookId } = await params;
  const look = await getPublicLook(lookId);
  if (!look) return { title: "Lookwise" };

  const title = `Lookwise — ${look.title}`;
  const description = describeLook(look);
  const canonicalPath = `/look/${lookId}`;
  const url = await absoluteUrl(canonicalPath);

  // No explicit `images` here: this segment's opengraph-image.tsx
  // (Next.js's file-convention API) generates a single collage image
  // combining every item's photo and Next auto-injects the og:image/
  // twitter:image tags for it — see that file for why a collage,
  // rather than one og:image tag per item, is what actually shows "all
  // items" in a Telegram link preview.
  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PublicLookPage({ params }: { params: Promise<PageParams> }) {
  const { lookId } = await params;
  const look = await getPublicLook(lookId);
  if (!look) notFound();

  return <PublicLookView look={look} lookId={lookId} />;
}

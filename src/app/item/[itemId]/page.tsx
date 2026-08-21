import type { Metadata } from "next";
import { fetchPublicProductWithFallback } from "@/lib/products/public";
import { decodeItemId } from "@/lib/products/itemId";
import { absoluteUrl } from "@/lib/url";
import { formatOgPrice } from "@/lib/og";
import { PublicItemView } from "@/components/products/PublicItemView";
import { ItemNotFoundView } from "@/components/products/ItemNotFoundView";

export const runtime = "nodejs";

interface PageParams {
  itemId: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { itemId } = await params;
  const result = await fetchPublicProductWithFallback(decodeItemId(itemId));
  if (!result) return { title: "Lookwise", robots: { index: false, follow: false } };
  const { product, isLive } = result;

  const title = `Lookwise — ${product.title}`;
  const description = isLive
    ? `${formatOgPrice(product.price, product.currency)} · Available on eBay`
    : "No longer available";
  const canonicalPath = `/item/${itemId}`;
  const url = await absoluteUrl(canonicalPath);

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: product.image ? [{ url: product.image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: product.image ? [product.image] : undefined,
    },
  };
}

export default async function PublicItemPage({ params }: { params: Promise<PageParams> }) {
  const { itemId } = await params;
  const decodedId = decodeItemId(itemId);
  const result = await fetchPublicProductWithFallback(decodedId);
  if (!result) return <ItemNotFoundView />;

  return <PublicItemView product={result.product} itemId={decodedId} isLive={result.isLive} />;
}

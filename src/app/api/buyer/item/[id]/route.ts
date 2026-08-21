import { NextResponse } from "next/server";
import { getProductById, EbayConfigError, EbayAuthError, EbayApiError } from "@/lib/ebay";
import { decodeItemId } from "@/lib/products/itemId";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decodedId = decodeItemId(id);
  if (!id || !id.trim()) {
    return NextResponse.json(
      { error: "invalid_request", message: "Item id is required." },
      { status: 400 },
    );
  }

  try {
    const product = await getProductById(decodedId);
    return NextResponse.json({ item: product });
  } catch (err) {
    if (err instanceof EbayConfigError) {
      return NextResponse.json(
        { error: "ebay_not_configured", stage: "ebay", message: "Product lookup is not configured yet." },
        { status: 503 },
      );
    }
    if (err instanceof EbayAuthError) {
      return NextResponse.json(
        {
          error: "ebay_auth_failed",
          stage: "ebay_auth",
          message: "Compass couldn't authenticate with eBay Sandbox. Please try again shortly.",
        },
        { status: 502 },
      );
    }
    if (err instanceof EbayApiError) {
      const status = err.status === 404 ? 404 : 502;
      return NextResponse.json(
        {
          error: status === 404 ? "item_not_found" : "ebay_lookup_failed",
          message:
            status === 404
              ? "This listing is no longer available in eBay Sandbox."
              : "Something went wrong while fetching this item from eBay.",
        },
        { status },
      );
    }
    return NextResponse.json(
      { error: "unknown", message: "Something went wrong while fetching this item." },
      { status: 500 },
    );
  }
}

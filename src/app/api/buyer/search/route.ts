import { NextResponse } from "next/server";
import { SearchRequestSchema } from "@/lib/schemas";
import {
  parseBuyerRequest,
  DeepSeekConfigError,
  DeepSeekApiError,
  DeepSeekOutputError,
} from "@/lib/ai";
import {
  searchProducts,
  EbayConfigError,
  EbayAuthError,
  EbayApiError,
} from "@/lib/ebay";

export const runtime = "nodejs";

// Stage-by-stage server logging. Only non-sensitive information is logged:
// never the DeepSeek key, the eBay client secret, the OAuth token or any
// Authorization header.
export async function POST(request: Request) {
  console.log("[Compass] buyer search started");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.error("[Compass] buyer search error: body was not valid JSON");
    return NextResponse.json(
      { error: "invalid_request", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsedInput = SearchRequestSchema.safeParse(body);
  if (!parsedInput.success) {
    console.error("[Compass] buyer search error: invalid request payload");
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Request must include a non-empty 'prompt' string.",
      },
      { status: 400 },
    );
  }
  const { prompt, locale, criteria: suppliedCriteria, offset } = parsedInput.data;

  // Paging in more results for a search already run on this device: the
  // criteria came back from the first response, so re-use it as-is and
  // skip DeepSeek entirely — re-parsing the same prompt on every "load
  // more" click would be slower and could reinterpret it differently the
  // second time around.
  let criteria = suppliedCriteria;
  if (!criteria) {
    try {
      console.log(`[Compass] DeepSeek parsing started (locale=${locale}, promptChars=${prompt!.length})`);
      criteria = await parseBuyerRequest(prompt!, locale);
      console.log(
        `[Compass] DeepSeek parsing succeeded: query="${criteria.query}" maxPrice=${criteria.maxPrice ?? "none"}`,
      );
    } catch (err) {
      if (err instanceof DeepSeekConfigError) {
        return NextResponse.json(
          {
            error: "ai_not_configured",
            stage: "deepseek",
            message: "AI search is not configured yet.",
          },
          { status: 503 },
        );
      }
      if (err instanceof DeepSeekOutputError) {
        return NextResponse.json(
          {
            error: "ai_invalid_output",
            stage: "deepseek",
            message: "Compass couldn't understand that request. Try rephrasing it.",
          },
          { status: 422 },
        );
      }
      if (err instanceof DeepSeekApiError) {
        return NextResponse.json(
          {
            error: "ai_api_error",
            stage: "deepseek",
            upstreamStatus: err.status || null,
            message: "Compass couldn't reach its AI service. Please try again.",
          },
          { status: 502 },
        );
      }
      console.error("[Compass] DeepSeek error: unexpected failure");
      return NextResponse.json(
        {
          error: "unknown",
          stage: "deepseek",
          message: "Something went wrong while understanding your request.",
        },
        { status: 500 },
      );
    }
  }

  try {
    const { items, total } = await searchProducts(criteria, { offset });
    // The offset to request next, not the one just fetched — callers page
    // by feeding this straight back in as `offset` on their next call.
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < total;
    console.log(`[Compass] eBay search succeeded: ${items.length} items (offset=${offset}, hasMore=${hasMore})`);

    if (items.length === 0 && offset === 0) {
      console.log("[Compass] search completed (no results)");
      return NextResponse.json({
        query: criteria,
        items,
        total: 0,
        offset: nextOffset,
        hasMore: false,
        warning: "no_results",
      });
    }

    console.log("[Compass] search completed");
    return NextResponse.json({ query: criteria, items, total, offset: nextOffset, hasMore });
  } catch (err) {
    if (err instanceof EbayConfigError) {
      return NextResponse.json(
        {
          error: "ebay_not_configured",
          stage: "ebay",
          message: "Product search is not configured yet.",
        },
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
      return NextResponse.json(
        {
          error: "ebay_search_failed",
          stage: "ebay_search",
          upstreamStatus: err.status || null,
          message: "Something went wrong while searching eBay.",
        },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    console.error("[Compass] eBay search error: unexpected failure");
    return NextResponse.json(
      { error: "unknown", stage: "ebay", message: "Something went wrong while searching eBay." },
      { status: 500 },
    );
  }
}

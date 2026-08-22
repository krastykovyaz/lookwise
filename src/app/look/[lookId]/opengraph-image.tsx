import { ImageResponse } from "next/og";
import { getPublicLook } from "@/lib/db/repositories/look";
import { formatOgPrice } from "@/lib/og";

// Telegram's regular link preview (a plain URL pasted in a chat) only
// ever shows ONE image no matter how many og:image tags a page has —
// multi-image galleries there are limited to Instant View (requires
// per-domain approval from Telegram) or a bot posting its own media
// group, neither of which apply to a shared link. So the only way to
// actually show "all items" in that one preview image is to render
// them together into a single collage image ourselves, at request
// time, and serve that as the (sole) og:image. This file is Next.js's
// built-in convention for exactly that — it auto-generates the
// og:image/twitter:image meta tags pointing at this route.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Lookwise look preview";

const BG = "#faf9f7";
const BORDER = "#e7e4dd";
const FOREGROUND = "#14130f";
const MUTED = "#6b6a63";

// next/og's own remote-image fetching has no error isolation: if ANY
// <img src="https://..."> it's given fails to decode (wrong format, a
// redirect to an HTML error page, a transient eBay CDN hiccup — all
// observed in practice), it throws and takes the WHOLE response down
// with it — the route 502s and the crawler gets no image at all,
// worse than showing fewer items. So each candidate image is resolved
// to a data: URI here first, with its own timeout and error handling;
// any image that fails is silently dropped rather than being allowed
// to break the other three.
async function toDataUri(url: string): Promise<string | null> {
  try {
    // A bare server-side fetch with no User-Agent/Accept is a common
    // trigger for CDN bot mitigation (eBay's image CDN sits behind
    // Akamai) — it can 403 or return an HTML challenge page instead of
    // the image, which without these headers looked identical to any
    // other failure. A real browser UA plus an explicit Accept header
    // avoids that. Also given more time than the previous 4s: these
    // URLs are upscaled to eBay's largest served size (see
    // lib/ebay/normalize.ts's upscaleEbayImageUrl), so fetching several
    // concurrently from a serverless function needs real headroom.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      console.warn(`[opengraph-image] item image fetch failed: HTTP ${res.status} for ${url}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      console.warn(`[opengraph-image] item image fetch returned non-image content-type "${contentType}" for ${url}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[opengraph-image] item image fetch threw for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function resolveGalleryImages(urls: string[]): Promise<string[]> {
  // Only ever need 4 tiles — no point resolving more candidates than
  // that even if the look has extra components with images.
  const settled = await Promise.allSettled(urls.slice(0, 4).map(toDataUri));
  return settled
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is string => v != null);
}

function Tile({ src, radius }: { src: string; radius: string }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        border: `1px solid ${BORDER}`,
        background: "#ffffff",
      }}
    >
      <img src={src} alt="" width={560} height={560} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
    </div>
  );
}

function Gallery({ images, extra }: { images: string[]; extra: number }) {
  const shown = images.slice(0, 4);

  if (shown.length <= 1) {
    return (
      <div style={{ display: "flex", flex: 1, gap: 12 }}>
        {shown[0] && <Tile src={shown[0]} radius="20px" />}
      </div>
    );
  }

  if (shown.length === 2) {
    return (
      <div style={{ display: "flex", flex: 1, gap: 12 }}>
        <Tile src={shown[0]} radius="20px" />
        <Tile src={shown[1]} radius="20px" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, gap: 12 }}>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12 }}>
        <Tile src={shown[0]} radius="20px" />
        {shown[2] && <Tile src={shown[2]} radius="20px" />}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12, position: "relative" }}>
        <Tile src={shown[1]} radius="20px" />
        {shown[3] && <Tile src={shown[3]} radius="20px" />}
        {extra > 0 && (
          <div
            style={{
              display: "flex",
              position: "absolute",
              right: 16,
              bottom: 16,
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 28,
              background: "rgba(20,19,15,0.82)",
              color: "#ffffff",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
}

function Fallback(title: string) {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: BG,
          fontFamily: "sans-serif",
          fontSize: 40,
          fontWeight: 700,
          color: FOREGROUND,
        }}
      >
        {title}
      </div>
    ),
    { ...size },
  );
}

async function renderLookImage(lookId: string): Promise<ImageResponse> {
  const look = await getPublicLook(lookId);

  const candidateUrls = (look?.components ?? [])
    .map((c) => c.product?.image)
    .filter((img): img is string => Boolean(img));
  const images = await resolveGalleryImages(candidateUrls);
  const extra = Math.max(0, candidateUrls.length - 4);

  const itemCount = look?.components.filter((c) => c.product).length ?? 0;
  const priceLine = look?.totalPrice != null ? formatOgPrice(look.totalPrice, look.currency) : null;
  const subtitle = [itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : null, priceLine]
    .filter(Boolean)
    .join(" · ");

  return new ImageResponse(
    (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            padding: 40,
            background: BG,
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: FOREGROUND }}>Lookwise</div>
            {subtitle && <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{subtitle}</div>}
          </div>

          <div style={{ display: "flex", flex: 1, marginTop: 24 }}>
            {images.length > 0 ? (
              <Gallery images={images} extra={extra} />
            ) : (
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 20,
                  border: `1px solid ${BORDER}`,
                  background: "#ffffff",
                  fontSize: 32,
                  color: MUTED,
                }}
              >
                {look?.title ?? "Lookwise"}
              </div>
            )}
          </div>

          {look?.title && (
            <div style={{ display: "flex", marginTop: 24, fontSize: 32, fontWeight: 600, color: FOREGROUND }}>
              {look.title}
            </div>
          )}
        </div>
    ),
    { ...size },
  );
}

export default async function Image({ params }: { params: Promise<{ lookId: string }> }) {
  const { lookId } = await params;

  // Never let this route fail the whole response — a crawler that gets
  // a 502 shows NO preview at all, worse than a plain branded fallback.
  try {
    return await renderLookImage(lookId);
  } catch (err) {
    console.error("[opengraph-image] look render failed:", err);
    return Fallback("Lookwise");
  }
}

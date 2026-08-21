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

function Gallery({ images }: { images: string[] }) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;

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

export default async function Image({ params }: { params: Promise<{ lookId: string }> }) {
  const { lookId } = await params;
  const look = await getPublicLook(lookId);

  const images = (look?.components ?? [])
    .map((c) => c.product?.image)
    .filter((img): img is string => Boolean(img));

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
            <Gallery images={images} />
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

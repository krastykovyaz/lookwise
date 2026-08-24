import sharp from "sharp";
import { getPublicLook } from "@/lib/db/repositories/look";
import { formatOgPrice } from "@/lib/og";

// This route composes several item photos (via sharp/libvips) in one
// request, on a long-running process that's also handling everything
// else Next.js's own sharp-backed image optimizer does concurrently.
// Under real production load this was observed spuriously throwing
// "Input buffer contains unsupported image format" — even for a
// trivial static SVG with zero remote images — while the exact same
// render always succeeded when invoked in isolation; that pattern
// points at resource contention (memory/cache pressure from decoding
// many large images concurrently across the process), not a decoding
// bug. Disabling sharp's operation cache stops it from accumulating
// unbounded state across many different one-off look images over the
// process's lifetime.
sharp.cache(false);

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
//
// This used to be built with next/og's ImageResponse (Satori + a
// bundled resvg WASM module). In production that WASM decoder was
// observed to degrade over a process's uptime until it failed on
// EVERY render — including a plain text box with zero remote images —
// while the exact same inputs always rendered fine in an isolated
// process. That's state corruption inside next/og's own dependency,
// not anything about our data, and not fixable from here. sharp (a
// native libvips binding, not WASM, and a completely separate module
// instance from next/og's bundled one) is used instead: the whole
// image is composed as one transparent-background SVG (text, borders,
// the "+N" badge) layered via sharp's compositor on top of each
// resized/rounded item photo.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Lookwise look preview";

const BG = "#faf9f7";
const BORDER = "#e7e4dd";
const FOREGROUND = "#14130f";
const MUTED = "#6b6a63";

const PADDING = 40;
const GAP = 12;
const RADIUS = 20;
const HEADER_TOP = PADDING;
const HEADER_HEIGHT = 34;
const TITLE_HEIGHT = 40;
const GALLERY_TOP = HEADER_TOP + HEADER_HEIGHT + 24;
const GALLERY_LEFT = PADDING;
const GALLERY_WIDTH = size.width - PADDING * 2;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Same layout the original Gallery/Tile components used: 1 -> full
// width, 2 -> side by side, 3-4 -> two stacked columns with a "+N"
// badge over the bottom-right tile if more items exist than fit.
function galleryLayout(count: number, galleryHeight: number): TileRect[] {
  const top = GALLERY_TOP;
  if (count <= 1) {
    return [{ x: GALLERY_LEFT, y: top, width: GALLERY_WIDTH, height: galleryHeight }];
  }
  if (count === 2) {
    const w = (GALLERY_WIDTH - GAP) / 2;
    return [
      { x: GALLERY_LEFT, y: top, width: w, height: galleryHeight },
      { x: GALLERY_LEFT + w + GAP, y: top, width: w, height: galleryHeight },
    ];
  }
  const colWidth = (GALLERY_WIDTH - GAP) / 2;
  const rowHeight = (galleryHeight - GAP) / 2;
  const leftX = GALLERY_LEFT;
  const rightX = GALLERY_LEFT + colWidth + GAP;
  const topY = top;
  const bottomY = top + rowHeight + GAP;
  const rects = [
    { x: leftX, y: topY, width: colWidth, height: rowHeight },
    { x: rightX, y: topY, width: colWidth, height: rowHeight },
  ];
  if (count >= 3) rects.push({ x: leftX, y: bottomY, width: colWidth, height: rowHeight });
  if (count >= 4) rects.push({ x: rightX, y: bottomY, width: colWidth, height: rowHeight });
  // Layout order must match visual reading order left-col-top,
  // right-col-top, left-col-bottom, right-col-bottom to mirror the
  // original component's [0,1,2,3] -> [topLeft,topRight,bottomLeft,bottomRight].
  return [rects[0], rects[1], rects[2], rects[3]].filter((r): r is TileRect => Boolean(r));
}

// next/og's own remote-image fetching had no error isolation — one bad
// image took the whole render down. Each candidate is still resolved
// independently here with its own timeout/validation, so one failure
// just drops that tile rather than breaking the others.
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

// Product cards elsewhere upscale eBay photos to their largest served
// size (lib/ebay/normalize.ts's upscaleEbayImageUrl — s-l1600, often
// several MB once decoded to raw pixels) because they're shown large.
// The tiles here are never bigger than ~560px, so decoding a full
// s-l1600 just to immediately downscale it wastes real memory for no
// visual benefit — exactly the kind of per-request cost that adds up
// into the resource contention described above. eBay's CDN serves the
// same photo at any s-lNNN size on request, so this asks for a size
// actually close to what's rendered instead.
const EBAY_SIZE_TOKEN_PATTERN = /s-l\d+(?=\.(?:jpg|jpeg|png|webp)(?:$))/i;
const OG_TILE_SIZE_TOKEN = "s-l500";

function downscaleForTile(url: string): string {
  if (!EBAY_SIZE_TOKEN_PATTERN.test(url)) return url;
  return url.replace(EBAY_SIZE_TOKEN_PATTERN, OG_TILE_SIZE_TOKEN);
}

async function fetchImageBuffer(rawUrl: string): Promise<Buffer | null> {
  const url = downscaleForTile(rawUrl);
  try {
    // A bare server-side fetch with no User-Agent/Accept is a common
    // trigger for CDN bot mitigation (eBay's image CDN sits behind
    // Akamai) — it can 403 or return an HTML challenge page instead of
    // the image. The Accept header only lists formats sharp/libvips
    // decodes, so a CDN doing content negotiation can't hand back
    // something we'd reject anyway.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/png,image/jpeg,image/webp,*/*;q=0.5",
      },
    });
    if (!res.ok) {
      console.warn(`[opengraph-image] item image fetch failed: HTTP ${res.status} for ${url}`);
      return null;
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
      console.warn(`[opengraph-image] item image fetch returned unsupported content-type "${contentType}" for ${url}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`[opengraph-image] item image fetch threw for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Resizes/crops to exactly fill the tile, then clips to a rounded
// rect via a mask composited with "dest-in" — the standard sharp
// technique for rounded-corner photos.
async function toRoundedTile(buffer: Buffer, rect: TileRect): Promise<Buffer | null> {
  try {
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const resized = await sharp(buffer).resize(w, h, { fit: "cover" }).png().toBuffer();
    const mask = Buffer.from(
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`,
    );
    return await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } catch (err) {
    console.warn(`[opengraph-image] failed to process item image for tile:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function resolveGalleryTiles(
  urls: string[],
  rects: TileRect[],
): Promise<{ input: Buffer; left: number; top: number }[]> {
  // Network fetches stay concurrent (cheap, I/O-bound — matters for
  // link-preview crawlers that don't wait long). The sharp/libvips
  // work (decode + resize + mask) runs one image at a time instead —
  // see this file's sharp.cache(false) comment for why: several
  // concurrent decodes of full-size photos is exactly the kind of
  // resource spike that was causing spurious render failures.
  const buffers = await Promise.allSettled(urls.slice(0, rects.length).map(fetchImageBuffer));
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const result = buffers[i];
    if (result.status !== "fulfilled" || !result.value) continue;
    const tile = await toRoundedTile(result.value, rects[i]);
    if (tile) tiles.push({ input: tile, left: Math.round(rects[i].x), top: Math.round(rects[i].y) });
  }
  return tiles;
}

function overlaySvg(params: {
  title: string | null;
  subtitle: string | null;
  tileRects: TileRect[];
  filledCount: number;
  extra: number;
  showEmptyBox: boolean;
}): Buffer {
  const { title, subtitle, tileRects, filledCount, extra, showEmptyBox } = params;
  const galleryBottom = tileRects.length > 0 ? Math.max(...tileRects.map((r) => r.y + r.height)) : GALLERY_TOP;
  const titleY = size.height - PADDING - TITLE_HEIGHT + 32;

  const borders = tileRects
    .slice(0, filledCount)
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="${BORDER}" stroke-width="1"/>`,
    )
    .join("");

  const badge =
    extra > 0 && tileRects.length >= 4
      ? (() => {
          const last = tileRects[3];
          const cx = last.x + last.width - 16 - 28;
          const cy = last.y + last.height - 16 - 28;
          return `<circle cx="${cx}" cy="${cy}" r="28" fill="rgba(20,19,15,0.82)"/><text x="${cx}" y="${cy + 8}" font-family="sans-serif" font-size="22" font-weight="600" fill="#ffffff" text-anchor="middle">+${extra}</text>`;
        })()
      : "";

  const emptyBox = showEmptyBox
    ? `<rect x="${GALLERY_LEFT}" y="${GALLERY_TOP}" width="${GALLERY_WIDTH}" height="${galleryBottom - GALLERY_TOP}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>` +
      (title
        ? `<text x="${size.width / 2}" y="${(GALLERY_TOP + galleryBottom) / 2 + 11}" font-family="sans-serif" font-size="32" fill="${MUTED}" text-anchor="middle">${escapeXml(title)}</text>`
        : "")
    : "";

  const subtitleText = subtitle
    ? `<text x="${size.width - PADDING}" y="${HEADER_TOP + 24}" font-family="sans-serif" font-size="24" fill="${MUTED}" text-anchor="end">${escapeXml(subtitle)}</text>`
    : "";

  const titleText = title
    ? `<text x="${PADDING}" y="${titleY}" font-family="sans-serif" font-size="32" font-weight="600" fill="${FOREGROUND}">${escapeXml(title)}</text>`
    : "";

  const svg = `<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
    <text x="${PADDING}" y="${HEADER_TOP + 24}" font-family="sans-serif" font-size="28" font-weight="700" fill="${FOREGROUND}">Lookwise</text>
    ${subtitleText}
    ${emptyBox}
    ${borders}
    ${badge}
    ${titleText}
  </svg>`;
  return Buffer.from(svg);
}

async function renderLookImage(lookId: string): Promise<Buffer> {
  const look = await getPublicLook(lookId);

  const candidateUrls = (look?.components ?? [])
    .map((c) => c.product?.image)
    .filter((img): img is string => Boolean(img));
  const extra = Math.max(0, candidateUrls.length - 4);

  const itemCount = look?.components.filter((c) => c.product).length ?? 0;
  const priceLine = look?.totalPrice != null ? formatOgPrice(look.totalPrice, look.currency) : null;
  const subtitle =
    [itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : null, priceLine].filter(Boolean).join(" · ") ||
    null;

  const galleryHeight = size.height - PADDING - TITLE_HEIGHT - 24 - GALLERY_TOP;
  const tileRects = galleryLayout(Math.min(candidateUrls.length, 4) || 1, galleryHeight);
  const tiles = candidateUrls.length > 0 ? await resolveGalleryTiles(candidateUrls, tileRects) : [];

  const overlay = overlaySvg({
    title: look?.title ?? "Lookwise",
    subtitle,
    tileRects,
    filledCount: tiles.length,
    extra,
    showEmptyBox: tiles.length === 0,
  });

  return sharp({ create: { width: size.width, height: size.height, channels: 4, background: BG } })
    .composite([...tiles, { input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

function fallbackBuffer(title: string): Promise<Buffer> {
  const svg = `<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size.width}" height="${size.height}" fill="${BG}"/>
    <text x="${size.width / 2}" y="${size.height / 2 + 14}" font-family="sans-serif" font-size="40" font-weight="700" fill="${FOREGROUND}" text-anchor="middle">${escapeXml(title)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export default async function Image({ params }: { params: Promise<{ lookId: string }> }) {
  const { lookId } = await params;

  // Never let this route fail the whole response — a crawler that gets
  // a 502 shows NO preview at all, worse than a plain branded fallback.
  try {
    const buffer = await renderLookImage(lookId);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("[opengraph-image] look render failed:", err);
    try {
      const buffer = await fallbackBuffer("Lookwise");
      return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "image/png" } });
    } catch (fallbackErr) {
      console.error("[opengraph-image] branded fallback also failed to render:", fallbackErr);
      return new Response(null, { status: 204 });
    }
  }
}

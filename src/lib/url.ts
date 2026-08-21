import "server-only";
import { headers } from "next/headers";
import { configuredPublicOrigin } from "@/lib/publicOrigin";

/** Builds an absolute URL for the current request, for use in
 *  generateMetadata (og:url, og:image, canonical — Telegram/social
 *  crawlers need a fully-qualified URL, a relative path won't do, and
 *  it must not be a localhost URL Telegram's servers can't reach).
 *
 *  Prefers NEXT_PUBLIC_APP_URL (see lib/publicOrigin.ts) so metadata
 *  is correct regardless of what host header a proxy/CDN happens to
 *  forward. Only falls back to reading the actual request host when
 *  that var isn't set — a dev/preview convenience so metadata URLs
 *  are still well-formed without extra setup; in local dev this
 *  fallback legitimately resolves to localhost, which is expected to
 *  be unshareable to an external crawler, not a bug in this
 *  function. */
export async function absoluteUrl(path: string): Promise<string> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configured = configuredPublicOrigin();
  if (configured) return `${configured}${normalizedPath}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${normalizedPath}`;
}

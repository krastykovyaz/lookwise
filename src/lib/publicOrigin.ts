// The configured production origin for anything a Telegram/WhatsApp/
// Discord crawler or a pasted link needs to be able to fetch —
// og:url, canonical, and the Share button's generated link.
// NEXT_PUBLIC_* env vars are inlined at build time, so this same
// function works unchanged on the server (generateMetadata via
// lib/url.ts), in the browser (components/share/ShareButton.tsx), and
// in edge middleware, without three separate copies of "read this env
// var and trim it" drifting apart.
//
// Deliberately does NOT fall back to a hardcoded production domain —
// an unset var means "no configured public origin", and callers each
// decide their own dev-only fallback (request headers on the server,
// window.location.origin on the client) rather than this function
// silently inventing one. See NEXT_PUBLIC_APP_URL in .env.example.
export function configuredPublicOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * eBay item ids contain literal `|` characters (v1|123|0). A shared
 * /item/[itemId] link passes through systems we don't control before
 * it's actually opened — messaging apps' link previews, redirect
 * wrappers, copy/paste — any of which can percent-encode an
 * already-encoded URL a second time. A single decodeURIComponent only
 * undoes one layer and leaves a residual "%7C" that eBay's API rejects
 * outright (400), which — with no not-found.tsx for this route at the
 * time this was found — surfaced to the user as a blank white page
 * instead of the item. Decode repeatedly until the string stops
 * changing; bounded so a malformed id can't loop forever.
 */
export function decodeItemId(raw: string): string {
  let value = raw;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(value);
    } catch {
      return value;
    }
    if (next === value) return value;
    value = next;
  }
  return value;
}

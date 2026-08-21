import { redirect } from "next/navigation";

// This route predates the rename of the "Discover" feature to /explore
// (the real, eBay-backed infinite feed). It's unlinked from the app's
// navigation, but it was still reachable directly and was serving
// MOCK_PRODUCTS under the "Discover" title — exactly the kind of
// user-visible mock fallback the app should never show in production.
// Rather than leave a dead mock page live at this URL (or a 404 for
// anyone with an old link), redirect to the real feed.
export default function DiscoverPage(): never {
  redirect("/explore");
}

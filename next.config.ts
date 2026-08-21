import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Placeholder image used when a listing has no picture.
      { protocol: "https", hostname: "images.unsplash.com" },
      // eBay listing images (Sandbox and Production both serve from these).
      // i.ebayimg.com  -> listing photos (image / thumbnailImages / additionalImages)
      // *.ebaystatic.com -> eBay's static/stock imagery (e.g. thumbs.ebaystatic.com)
      { protocol: "https", hostname: "i.ebayimg.com" },
      { protocol: "https", hostname: "*.ebaystatic.com" },
      // Individual sellers can host their own listing photos anywhere
      // (S3 buckets, third-party CDNs, image-upscaling services, etc.)
      // — eBay's API just returns whatever URL that seller's listing
      // points to. A fixed per-host allowlist breaks every time a new
      // listing uses a host we haven't seen (this is what caused the
      // s3.us-east-1.amazonaws.com crash), so this wildcard trusts any
      // https image host. The URLs still only ever come from eBay's
      // structured API response, not raw user/URL input, so this
      // doesn't add an arbitrary-URL-fetch surface beyond what the app
      // already implies by showing eBay's own listing photos.
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthSessionProvider } from "@/components/auth/AuthSessionProvider";
import { MergeOnSignIn } from "@/components/auth/MergeOnSignIn";
import { I18nProvider } from "@/lib/i18n";
import { BuyerResultsProvider } from "@/lib/results";
import { StyleProfileProvider } from "@/lib/style/context";
import { LookHistoryProvider } from "@/lib/look/history";
import { SavedLooksProvider } from "@/lib/look/savedLooks";
import { CurrencyProvider } from "@/lib/currency/context";
import { ViewedProductsProvider } from "@/lib/products/viewed";
import { FavoritesProvider } from "@/lib/products/favorites";
import { PreferenceSignalsProvider } from "@/lib/style/preferences";
import { ProductSignalsProvider } from "@/lib/style/productSignals";
import { EventsProvider } from "@/lib/events/context";
import { ExploreFeedProvider } from "@/lib/explore/session";
import { NavigationStateProvider } from "@/lib/navigation/state";
import { AppShell } from "@/components/layout/AppShell";
import { configuredPublicOrigin } from "@/lib/publicOrigin";

// Without this, Next.js has no way to resolve relative asset URLs it
// generates itself (e.g. the file-convention opengraph-image.tsx routes)
// into absolute ones, and falls back to http://localhost:<port> — a URL
// Telegram/social crawlers can never reach. Every *page's own*
// generateMetadata already builds absolute URLs explicitly via
// lib/url.ts's absoluteUrl(), which doesn't depend on this; this is
// specifically for metadata Next.js derives on its own.
const publicOrigin = configuredPublicOrigin();

export const metadata: Metadata = {
  ...(publicOrigin ? { metadataBase: new URL(publicOrigin) } : {}),
  title: "Lookwise — AI-powered fashion discovery",
  description:
    "Discover fashion, search by image, build Looks and find products with Compass AI.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthSessionProvider>
          <I18nProvider>
          <CurrencyProvider>
            <BuyerResultsProvider>
              <StyleProfileProvider>
                <LookHistoryProvider>
                  <SavedLooksProvider>
                  <ViewedProductsProvider>
                    <FavoritesProvider>
                      <PreferenceSignalsProvider>
                      <ProductSignalsProvider>
                      <EventsProvider>
                        <ExploreFeedProvider>
                          <NavigationStateProvider>
                            <MergeOnSignIn />
                            <AppShell>{children}</AppShell>
                          </NavigationStateProvider>
                        </ExploreFeedProvider>
                      </EventsProvider>
                      </ProductSignalsProvider>
                      </PreferenceSignalsProvider>
                    </FavoritesProvider>
                  </ViewedProductsProvider>
                  </SavedLooksProvider>
                </LookHistoryProvider>
              </StyleProfileProvider>
            </BuyerResultsProvider>
          </CurrencyProvider>
          </I18nProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

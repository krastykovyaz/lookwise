 "use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBuyerResults } from "@/lib/results";
import { useExploreFeed } from "@/lib/explore/session";

export type MainTab = "explore" | "search" | "overview" | "profile";

interface NavigationState {
  activeTab: MainTab;
  returnPaths: Record<MainTab, string>;
  scrollPositions: Record<string, number>;
  searchQuery: string;
  searchVisibleCount: number;
}

interface NavigationContextValue extends NavigationState {
  switchTab: (tab: MainTab) => void;
  setSearchQuery: (value: string) => void;
  setSearchVisibleCount: (value: number) => void;
  saveCurrentPosition: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

const ROOT_PATHS: Record<MainTab, string> = {
  explore: "/explore",
  search: "/",
  overview: "/overview",
  profile: "/profile",
};

function tabForRoot(pathname: string): MainTab | null {
  if (pathname === "/explore" || pathname.startsWith("/explore/")) return "explore";
  if (pathname === "/overview" || pathname.startsWith("/overview/")) return "overview";
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return "profile";
  if (
    pathname === "/" ||
    pathname === "/results" ||
    pathname.startsWith("/results/") ||
    pathname === "/look" ||
    pathname.startsWith("/look/")
  ) {
    return "search";
  }
  return null;
}

function initialTab(pathname: string): MainTab {
  return tabForRoot(pathname) ?? "search";
}

function isPrimaryRoot(pathname: string): boolean {
  return Object.values(ROOT_PATHS).includes(pathname);
}

export function NavigationStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clearResults } = useBuyerResults();
  const {
    refresh: refreshExplore,
    captureScrollSnapshot: captureExploreScroll,
  } = useExploreFeed();
  const [currentPath, setCurrentPath] = useState(pathname);
  const pathnameRef = useRef(currentPath);
  const activeTabRef = useRef<MainTab>(initialTab(pathname));

  const scrollPositionsRef = useRef<Record<string, number>>({});

  const [state, setState] = useState<NavigationState>(() => {
    const tab = initialTab(pathname);
    return {
      activeTab: tab,
      returnPaths: { ...ROOT_PATHS },
      scrollPositions: {},
      searchQuery: "",
      searchVisibleCount: 0,
    };
  });

  const savePositionForPath = useCallback((path: string) => {
    if (typeof window === "undefined") return;
    const y = window.scrollY;
    const previous = scrollPositionsRef.current[path];
    if (previous === y) return;
    scrollPositionsRef.current[path] = y;
    setState((s) => ({
      ...s,
      scrollPositions: { ...s.scrollPositions, [path]: y },
    }));
  }, []);

  const saveCurrentPosition = useCallback(() => {
    savePositionForPath(pathnameRef.current);
  }, [savePositionForPath]);

  // Keep the last route belonging to the current tab. Detail routes such
  // as /look, /product/... and /results belong to whichever main tab the
  // user was using when they opened them. This is what makes:
  // Overview -> Item -> Profile -> Overview return to Item, and
  // Explore -> Look -> Search -> Explore return to Look.
  useEffect(() => {
    const fullPath = typeof window !== "undefined"
      ? `${pathname}${window.location.search}`
      : pathname;
    setCurrentPath(fullPath);
    pathnameRef.current = fullPath;

    const rootTab = tabForRoot(pathname);
    if (rootTab && isPrimaryRoot(pathname)) {
      activeTabRef.current = rootTab;
      setState((s) => ({
        ...s,
        activeTab: rootTab,
        returnPaths: { ...s.returnPaths, [rootTab]: fullPath },
      }));
      return;
    }

    // A nested/detail route does not change the active main tab. It is
    // remembered as the return route for the tab that opened it.
    if (rootTab === "search" && pathname === "/login") return;

    const activeTab = activeTabRef.current;
    setState((s) => ({
      ...s,
      activeTab,
      returnPaths: { ...s.returnPaths, [activeTab]: fullPath },
    }));
  }, [pathname]);

  // Track scroll for every route while it is visible. This is intentionally
  // in-memory only: a real browser reload creates a fresh provider and
  // therefore a fresh navigation session.
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        savePositionForPath(pathnameRef.current);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [savePositionForPath]);

  // Restore the exact scroll position after a tab/detail route becomes
  // active. Wait until the document has enough height so a large saved
  // position is not clamped to the top while content is still mounting.
  useLayoutEffect(() => {
    // Explore has its own anchor-aware restoration because card/image layout
    // can change document height. Let that provider be the sole authority
    // on /explore while this generic mechanism handles every other tab/route.
    if (pathname === "/explore") return;
    const target = state.scrollPositions[currentPath];
    if (target == null || target <= 0) return;

    let attempts = 0;
    let cancelled = false;

    const restore = () => {
      if (cancelled) return;
      attempts += 1;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );

      if (maxScroll >= target || attempts >= 30) {
        window.scrollTo(0, Math.min(target, maxScroll));
        return;
      }

      requestAnimationFrame(restore);
    };

    requestAnimationFrame(restore);

    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const switchTab = useCallback(
    (tab: MainTab) => {
      // Tapping a tab while it's already the active one (even from a nested
      // detail route it owns, e.g. Overview -> /product/xxx) is an explicit
      // second tap: reset to that tab's default root view. Tapping in FROM
      // another tab is the first tap and instead restores whatever nested
      // state was last remembered for it (the branch below).
      const isActiveTab = tab === activeTabRef.current;

      // A second click on the already-active tab is an explicit reset.
      // This MUST be decided from the actual tab-button click, not from
      // route changes/effects/mounts. Normal navigation back to a tab
      // must always restore its remembered state.
      if (isActiveTab) {
        if (tab === "explore") captureExploreScroll();
        saveCurrentPosition();

        const root = ROOT_PATHS[tab];
        activeTabRef.current = tab;

        setState((s) => ({
          ...s,
          activeTab: tab,
          returnPaths: { ...s.returnPaths, [tab]: root },
          ...(tab === "search"
            ? { searchQuery: "", searchVisibleCount: 0 }
            : {}),
        }));

        // An explicit second click is a real reset, not a navigation
        // restore. Explore gets a genuinely fresh feed/session; Search
        // clears its in-memory results.
        if (tab === "explore") {
          void refreshExplore();
        } else if (tab === "search") {
          clearResults();
        }

        router.push(root, { scroll: false });
        if (tab === "overview") {
          requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
        }
        return;
      }

      if (activeTabRef.current === "explore") captureExploreScroll();
      saveCurrentPosition();

      const target = state.returnPaths[tab] || ROOT_PATHS[tab];

      activeTabRef.current = tab;
      setState((s) => ({ ...s, activeTab: tab }));
      router.push(target, { scroll: false });

      // A first-time visit to Overview has no saved position yet, so make
      // the initial/root Overview deterministic. Subsequent visits use the
      // normal saved route + scroll restoration above.
      if (tab === "overview" && target === ROOT_PATHS.overview && state.scrollPositions[ROOT_PATHS.overview] == null) {
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      }
    },
    [router, saveCurrentPosition, state.returnPaths, refreshExplore, clearResults, captureExploreScroll],
  );

  const setSearchQuery = useCallback((value: string) => {
    setState((s) => ({ ...s, searchQuery: value }));
  }, []);

  const setSearchVisibleCount = useCallback((value: number) => {
    setState((s) => ({ ...s, searchVisibleCount: value }));
  }, []);

  const value = useMemo(
    () => ({ ...state, switchTab, setSearchQuery, setSearchVisibleCount, saveCurrentPosition }),
    [state, switchTab, setSearchQuery, setSearchVisibleCount, saveCurrentPosition],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationState() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigationState must be used within NavigationStateProvider");
  }
  return context;
}

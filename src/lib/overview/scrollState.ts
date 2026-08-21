export type OverviewScrollSnapshot = {
  scrollY: number;
  anchorId: string | null;
  anchorOffset: number;
};

export function captureOverviewScroll(): OverviewScrollSnapshot {
  if (typeof window === "undefined") {
    return { scrollY: 0, anchorId: null, anchorOffset: 0 };
  }

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-overview-item-id], [data-overview-look-id]")
  );

  let anchorId: string | null = null;
  let anchorOffset = 0;
  let bestTop = -Infinity;

  for (const node of nodes) {
    const top = node.getBoundingClientRect().top;
    if (top <= 80 && top > bestTop) {
      anchorId =
        node.dataset.overviewItemId ??
        node.dataset.overviewLookId ??
        null;
      anchorOffset = top;
      bestTop = top;
    }
  }

  return {
    scrollY: window.scrollY,
    anchorId,
    anchorOffset,
  };
}

export function resetOverviewScroll(): void {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

export function restoreOverviewScroll(snapshot: OverviewScrollSnapshot): void {
  if (typeof window === "undefined") return;

  const restore = () => {
    if (snapshot.anchorId) {
      const escaped =
        typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape(snapshot.anchorId)
          : snapshot.anchorId.replace(/"/g, '\\"');

      const node = document.querySelector<HTMLElement>(
        `[data-overview-item-id="${escaped}"], [data-overview-look-id="${escaped}"]`
      );

      if (node) {
        const delta = node.getBoundingClientRect().top - snapshot.anchorOffset;
        window.scrollBy(0, delta);
        return;
      }
    }

    window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
  };

  requestAnimationFrame(() => requestAnimationFrame(restore));
}

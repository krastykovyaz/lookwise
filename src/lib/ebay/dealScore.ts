// Deal Score: a temporary Milestone 1 heuristic only — never an
// authoritative market valuation. Combines four weak signals into a
// 0-100 number so results can be ranked and the UI has something to
// show. Each signal degrades gracefully to "neutral" when the
// underlying eBay data isn't present, rather than penalizing the item.

interface DealScoreInput {
  price: number | null;
  priceGroupMin: number | null;
  priceGroupMax: number | null;
  conditionId: string | null;
  sellerFeedbackPercentage: number | null;
  hasShipping: boolean;
}

export function computeDealScore(input: DealScoreInput): number {
  let score = 50;

  // Cheaper within the result set scores higher (weight 25).
  if (
    input.price != null &&
    input.priceGroupMin != null &&
    input.priceGroupMax != null &&
    input.priceGroupMax > input.priceGroupMin
  ) {
    const position =
      (input.price - input.priceGroupMin) /
      (input.priceGroupMax - input.priceGroupMin);
    score += Math.round((1 - position) * 25);
  }

  // Condition (weight 15) — very rough, matches the conditionId
  // convention used in browse.ts (1000 = new, 3000 = used/pre-owned).
  if (input.conditionId === "1000") score += 15;
  else if (input.conditionId === "3000") score += 8;

  // Seller feedback percentage (weight 15).
  if (input.sellerFeedbackPercentage != null) {
    score += Math.round(((input.sellerFeedbackPercentage - 90) / 10) * 15);
  }

  // Known shipping cost/availability (weight 5) — reduces uncertainty.
  if (input.hasShipping) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

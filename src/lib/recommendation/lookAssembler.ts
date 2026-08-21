import "server-only";
import type {
  ExploreFeedItem,
  ProductRoleBucket,
  RecommendationCandidate,
  RecommendationContext,
} from "@/types/explore";
import type { OutfitComponent } from "@/types/style";
import { contextMatch, weatherMatch } from "@/lib/recommendation/featureExtractor";
import { colorCompatibility, extractColor } from "@/lib/recommendation/color";
import { OUTFIT_COMPATIBILITY_WEIGHTS } from "@/lib/recommendation/config";
import { getProductGender, gendersCompatible, type ProductGender } from "@/lib/recommendation/gender";

const BUCKET_LABEL: Record<string, string> = {
  top: "Top",
  bottom: "Bottom",
  outerwear: "Outerwear",
  footwear: "Footwear",
  accessory: "Accessory",
  other: "Pick",
};

// Section 5: a normal outfit tries top/bottom/footwear plus optional
// outerwear/accessory, in that rough priority — not every category is
// required. The anchor (the candidate the look is built around) already
// covers one role; this is the fill order for the rest.
const ROLE_FILL_PRIORITY: ProductRoleBucket[] = ["footwear", "top", "bottom", "outerwear", "accessory"];
const MAX_COMPONENTS = 4;
// How far ahead in the ranked list to look for a compatible piece —
// bounded so this stays O(pool size * window), cheap and deterministic
// (section 5: "Do NOT implement an expensive LLM call for every
// candidate... must remain deterministic and cheap").
const LOOKAHEAD_WINDOW = 12;
// Below this, a filler candidate isn't worth pairing — better to leave
// the look with fewer pieces than force a poor combination.
const MIN_COMPATIBILITY_THRESHOLD = 0.45;
// How many runner-up candidates to keep as "Change" alternatives for
// a filled-role component — this is the fix for a real gap: Explore's
// look assembly previously always produced `alternatives: []`, so the
// "Change" button was permanently disabled on any look opened from
// Explore (only /look's own live-generation flow populated
// alternatives). Bounded to keep the response payload small; these
// come for free out of the compatibility search already being done
// below, not an extra pass over the pool.
const MAX_ALTERNATIVES_PER_COMPONENT = 4;

const FORMAL_PATTERN = /(blazer|suit|oxford|heel|dress shirt|trouser|silk|elegant|tailored)/i;
const CASUAL_PATTERN = /(sneaker|jean|t-?shirt|hoodie|jogger|sweatshirt|tank)/i;

// Crude formality match — both pieces read as formal, or both read as
// casual, count as compatible; a formal/casual mismatch is penalized.
// This is the "style compatibility" component (section 5.2), kept to
// keyword matching for the same cost reasons as everything else here.
function styleCompatibility(anchor: RecommendationCandidate, candidate: RecommendationCandidate): number {
  const aFormal = FORMAL_PATTERN.test(anchor.product.title);
  const aCasual = CASUAL_PATTERN.test(anchor.product.title);
  const bFormal = FORMAL_PATTERN.test(candidate.product.title);
  const bCasual = CASUAL_PATTERN.test(candidate.product.title);
  if ((aFormal && bCasual) || (aCasual && bFormal)) return 0.3;
  if ((aFormal && bFormal) || (aCasual && bCasual)) return 0.85;
  return 0.55; // no strong signal either way
}

// compatibility = colorCompatibility + styleCompatibility +
// weatherCompatibility + contextCompatibility (section 5), each
// weighted via OUTFIT_COMPATIBILITY_WEIGHTS (config.ts).
function compatibilityScore(
  anchor: RecommendationCandidate,
  candidate: RecommendationCandidate,
  context: RecommendationContext,
): number {
  const w = OUTFIT_COMPATIBILITY_WEIGHTS;
  const color = colorCompatibility(extractColor(anchor.product), extractColor(candidate.product));
  const style = styleCompatibility(anchor, candidate);
  // Reuse each candidate's already-computed weather/context fit (section
  // 3/4's real scoring functions) rather than a third scoring system —
  // a filler piece that's a poor weather/occasion fit on its own is
  // also a poor fit for this outfit.
  const weather = candidate.score?.weatherMatch ?? weatherMatch(candidate, context);
  const ctx = candidate.score?.contextMatch ?? contextMatch(candidate, context);
  return color * w.color + style * w.style + weather * w.weather + ctx * w.context;
}

function titleFor(group: RecommendationCandidate[], context: RecommendationContext): string {
  if (group.length === 1) return group[0].product.title.split(" ").slice(0, 5).join(" ");
  const styleLabel = context.profile?.styleArchetypes[0]?.replace("_", " ");
  const timeLabel = context.temporal?.timeOfDay;
  const parts = [styleLabel, timeLabel].filter(Boolean);
  return parts.length > 0 ? `${capitalize(parts.join(" "))} look` : "Everyday look";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function styleNotesFor(group: RecommendationCandidate[], context: RecommendationContext): string[] {
  const notes: string[] = [];
  if (group.length > 1) notes.push("Complementary pieces");
  const avgWeather = group.reduce((sum, c) => sum + (c.score?.weatherMatch ?? 0.5), 0) / group.length;
  if (context.weather && avgWeather > 0.75) notes.push("Weather appropriate");
  const avgPreference = group.reduce((sum, c) => sum + (c.score?.preferenceMatch ?? 0.5), 0) / group.length;
  if (avgPreference > 0.65) notes.push("Matches what you like");
  if (group.some((c) => c.classification === "exploration")) notes.push("Something a little different");
  if (group.length > 1) {
    let pairs = 0;
    let sum = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        sum += colorCompatibility(extractColor(group[i].product), extractColor(group[j].product));
        pairs++;
      }
    }
    if (pairs > 0 && sum / pairs > 0.75) notes.push("Color-coordinated");
  }
  return notes;
}

function classificationFor(group: RecommendationCandidate[]): ExploreFeedItem["classification"] {
  const counts = { familiar: 0, adjacent: 0, exploration: 0 };
  for (const c of group) counts[c.classification]++;
  if (counts.exploration > 0 && counts.exploration >= counts.familiar) return "exploration";
  if (counts.adjacent > counts.familiar) return "adjacent";
  return "familiar";
}

function createId(group: RecommendationCandidate[]): string {
  return `look-${group.map((c) => c.product.id).join("-").slice(0, 120)}`;
}

function buildFeedItem(
  group: RecommendationCandidate[],
  context: RecommendationContext,
  includeDebug: boolean,
  alternativesByProductId?: Map<string, RecommendationCandidate["product"][]>,
): ExploreFeedItem {
  const components: OutfitComponent[] = group.map((c) => ({
    role: c.bucket,
    searchQuery: c.sourceQuery,
    productId: c.product.id,
    product: c.product,
    alternatives: alternativesByProductId?.get(c.product.id) ?? [],
  }));
  const priced = group.map((c) => c.product);

  return {
    look: {
      id: createId(group),
      createdAt: new Date().toISOString(),
      title: titleFor(group, context),
      components,
      totalPrice: priced.length > 0 ? priced.reduce((sum, p) => sum + p.price, 0) : null,
      currency: priced[0]?.currency ?? null,
      styleNotes: styleNotesFor(group, context),
    },
    classification: classificationFor(group),
    debug: includeDebug ? { scores: group.map((c) => c.score!).filter(Boolean) } : undefined,
  };
}

// Compatibility-based outfit assembly (section 5): walk the ranked list
// in order; each not-yet-used candidate becomes the "anchor" of a new
// look, and for each missing role (section 5: top/bottom/footwear plus
// optional outerwear/accessory) we look a bounded window ahead for the
// best-compatible not-yet-used candidate in that role, falling back to
// leaving the role empty rather than forcing a poor pairing (section 5:
// "Do NOT require every category"). Every candidate ends up in exactly
// one look — either as an anchor (a "spotlight" card, when nothing
// compatible was nearby) or as a filler piece.
export function assembleLooks(
  rankedCandidates: RecommendationCandidate[],
  context: RecommendationContext,
  includeDebug: boolean,
): ExploreFeedItem[] {
  const used = new Set<string>();
  const items: ExploreFeedItem[] = [];

  for (let i = 0; i < rankedCandidates.length; i++) {
    const anchor = rankedCandidates[i];
    if (used.has(anchor.product.id)) continue;
    used.add(anchor.product.id);

    if (anchor.bucket === "other") {
      items.push(buildFeedItem([anchor], context, includeDebug));
      continue;
    }

    const group: RecommendationCandidate[] = [anchor];
    let lookGender: ProductGender = getProductGender(anchor.product);
    const usedSellers = new Set<string>();
    if (anchor.product.seller?.username) usedSellers.add(anchor.product.seller.username);
    const rolesToFill = ROLE_FILL_PRIORITY.filter((role) => role !== anchor.bucket);
    const windowEnd = Math.min(rankedCandidates.length, i + 1 + LOOKAHEAD_WINDOW);
    const alternativesByProductId = new Map<string, RecommendationCandidate["product"][]>();

    for (const role of rolesToFill) {
      if (group.length >= MAX_COMPONENTS) break;

      let best: RecommendationCandidate | null = null;
      let bestScore = -Infinity;
      // Every candidate that clears the compatibility bar for this
      // role, not just the winner — the ones that don't get picked as
      // `best` become that component's "Change" alternatives below,
      // rather than being discarded.
      const eligible: { candidate: RecommendationCandidate; score: number }[] = [];
      for (let k = i + 1; k < windowEnd; k++) {
        const candidate = rankedCandidates[k];
        if (used.has(candidate.product.id) || candidate.bucket !== role) continue;
        const candidateGender = getProductGender(candidate.product);
        if (!gendersCompatible(lookGender, candidateGender)) continue;
        // Every component in a look must be from a distinct seller —
        // "cards should be formed from unique [sellers]" — so a
        // candidate whose seller is already used elsewhere in this
        // same group is skipped, same as an already-used product id.
        const candidateSeller = candidate.product.seller?.username;
        if (candidateSeller && usedSellers.has(candidateSeller)) continue;
        const score = compatibilityScore(anchor, candidate, context);
        if (score >= MIN_COMPATIBILITY_THRESHOLD) eligible.push({ candidate, score });
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best && bestScore >= MIN_COMPATIBILITY_THRESHOLD) {
        const bestGender = getProductGender(best.product);
        if (!gendersCompatible(lookGender, bestGender)) continue;
        group.push(best);
        used.add(best.product.id);
        if (best.product.seller?.username) usedSellers.add(best.product.seller.username);
        if (lookGender === "unknown" && bestGender !== "unknown") lookGender = bestGender;

        const alternatives = eligible
          .filter((e) => e.candidate.product.id !== best!.product.id)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_ALTERNATIVES_PER_COMPONENT)
          .map((e) => e.candidate.product);
        if (alternatives.length > 0) alternativesByProductId.set(best.product.id, alternatives);
      }
    }

    items.push(buildFeedItem(group, context, includeDebug, alternativesByProductId));
  }

  return items;
}

export { BUCKET_LABEL, compatibilityScore, styleCompatibility };

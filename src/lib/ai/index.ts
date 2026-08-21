// DeepSeek AI boundary — public surface for the rest of the app.
//
// Server-only (imports "server-only" transitively via deepseek.ts).
// Never call these from a client component; they must be reached
// through a route handler (see src/app/api/buyer).

import "server-only";
import {
  parseBuyerRequest as parseBuyerRequestImpl,
  askAboutProduct as askAboutProductImpl,
  DeepSeekConfigError,
  DeepSeekApiError,
  DeepSeekOutputError,
  type AskableProduct,
} from "@/lib/ai/deepseek";
import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";
import type { Locale } from "@/types/locale";

export { DeepSeekConfigError, DeepSeekApiError, DeepSeekOutputError };
export type { AskableProduct };

export async function parseBuyerRequest(
  request: string,
  locale: Locale,
): Promise<ValidatedEbaySearchCriteria> {
  return parseBuyerRequestImpl(request, locale);
}

export async function askAboutProduct(
  question: string,
  product: AskableProduct,
  locale: Locale,
): Promise<string> {
  return askAboutProductImpl(question, product, locale);
}

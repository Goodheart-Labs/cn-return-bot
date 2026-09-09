/**
 * Truth rating for the everything pipeline.
 *
 * Extraction gives us the claims of an item but says nothing about whether they
 * are true. This step rates all of them in one call. Opus gets the item's full
 * text and the claims as a numbered JSON object, together with Claude's built-in web
 * search and web fetch tools, and returns one rating per claim on a seven-level
 * scale. The rating decides which claims get fact-checked.
 *
 * One call for the whole item is deliberate. The claims of one post are
 * correlated, and a single good source often settles most of them. A search per
 * claim cannot see that. That is what the per-claim fact-check already does.
 */

import { llm } from "../../pipeline/llm/llm";
import { claimCheckFields } from "./claimCheckFields";
import { WEB_SEARCH_TOOL, webFetchNativeTool } from "../../pipeline/tool-calling/tools";
import { parseJsonWithRetry } from "../../pipeline/utils/jsonLlmCall";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../../pipeline/cost-tracking/pricing";
import type { ExtractedClaim, ItemSource, RatedClaim } from "../types";

const CLAIM_RATING_MODEL = "anthropic/claude-opus-5";

// Bounds on the research inside one call. Every search costs a cent and every
// fetched page is billed as input tokens, so these keep a long item at a couple
// of dollars. The per-page cap matters most. An uncapped page can be 100,000
// tokens.
const MAX_SEARCHES_PER_ITEM = 12;
const MAX_FETCHES_PER_ITEM = 6;
const MAX_TOKENS_PER_FETCHED_PAGE = 20_000;

// The research happens through the tools, so the model does not need to think
// long on its own. High effort would only add reasoning tokens.
const RATING_REASONING_EFFORT = "medium";

// The list runs from most true to most false. A judgement's index in it decides
// whether the claim gets fact-checked.
export const JUDGEMENTS = [
  "certainly true",
  "likely true",
  "somewhat likely true",
  "uncertain",
  "somewhat likely false",
  "likely false",
  "certainly false",
] as const;

// We only fact-check a claim the rater is not confident about, so "uncertain"
// and everything below it.
const FACT_CHECK_FROM = JUDGEMENTS.indexOf("uncertain");
export function shouldFactCheck(judgement: string): boolean {
  const idx = (JUDGEMENTS as readonly string[]).indexOf(judgement);
  return idx === -1 || idx >= FACT_CHECK_FROM; // A judgement we do not recognize is checked to be safe.
}

// A claim the rater left out, or rated with a word outside the scale, is
// treated as uncertain, so it still gets checked.
const UNRATED_JUDGEMENT = "uncertain";

const RATING_SCHEMA_HINT = `{ "research": string, "ratings": [{ "claim": number, "rating": string }] }`;

const RATING_SYSTEM_PROMPT = `You rate how true the factual claims of a text are. You get the full text of an article or transcript and the claims extracted from it as a JSON object keyed by claim number. Each claim is the author's own words, with the passage it sits in.

Research first. Use web_search to find sources on the events, people and figures the text is about, and web_fetch to read the most relevant pages in full. Related claims usually share a source, so read the few pages that settle many claims at once.

Then rate EVERY numbered claim on this scale: ${JUDGEMENTS.join(", ")}. Rate from the evidence you found plus your own knowledge. Use "uncertain" only when nothing you found bears on the claim. A claim rated uncertain or worse is sent to a costly fact-check, so be as decisive as the evidence allows.

Rate the claim as stated, not its gist. A claim is true only if its names, numbers, dates and attributions are right. If the substance holds but the claim names the wrong person, source or figure, it is false: that wrong detail is exactly what a note would correct.

Respond with strict JSON only matching: ${RATING_SCHEMA_HINT}
- research: a dense summary of what you found, with the full https:// URL of each source inline.
- ratings: one entry per claim number.`;

// The rater sees each claim exactly as the fact-check will see it, keyed by its
// number in the list. The number is what the model answers with.
function ratingUserMessage(text: string, claims: ExtractedClaim[], source: ItemSource): string {
  const numbered = Object.fromEntries(claims.map((c, i) => [i + 1, claimCheckFields(c, source)]));
  return `Text:\n\n${text}\n\nClaims:\n${JSON.stringify(numbered, null, 1)}`;
}

interface RatingOutput {
  research: string;
  ratings: { claim: number; rating: string }[];
}

/** Parses the model's reply and checks its shape. Throws on anything else, so
 *  the retry loop can ask the model again. */
export function parseRatingOutput(toParse: string): RatingOutput {
  const output = JSON.parse(toParse) as RatingOutput;
  const shapeOk =
    typeof output.research === "string" &&
    Array.isArray(output.ratings) &&
    output.ratings.every((r) => typeof r?.claim === "number" && typeof r?.rating === "string");
  if (!shapeOk) throw new Error("rating JSON missing research/ratings");
  return output;
}

/** Attaches the ratings to the claims by their number in the list. Claim
 *  numbers that do not exist are ignored. A claim without a valid rating gets
 *  the unrated judgement. */
export function applyRatings(claims: ExtractedClaim[], ratings: RatingOutput["ratings"]): RatedClaim[] {
  const byNumber = new Map<number, string>();
  for (const { claim, rating } of ratings) {
    if ((JUDGEMENTS as readonly string[]).includes(rating)) byNumber.set(claim, rating);
  }
  return claims.map((claim, i) => ({ ...claim, judgement: byNumber.get(i + 1) ?? UNRATED_JUDGEMENT }));
}

export interface ClaimRatingResult {
  claims: RatedClaim[];
  /** What the model found, with its source URLs. This is the only record of the
   *  research, because the step writes no run row. It is logged, not stored. */
  research: string;
  cost: TokenCost;
  webSearches: number;
  /** Input tokens served from Anthropic's prompt cache, at a tenth of the price. */
  cachedInputTokens: number;
}

export async function rateClaims(text: string, claims: ExtractedClaim[], source: ItemSource): Promise<ClaimRatingResult> {
  if (claims.length === 0) return { claims: [], research: "", cost: emptyTokenCost(), webSearches: 0, cachedInputTokens: 0 };

  const messages: any[] = [
    { role: "system", content: RATING_SYSTEM_PROMPT },
    // The cache breakpoint marks the text and claims as a prefix Anthropic may
    // reuse. Every search or fetch inside the call is a new iteration that is
    // billed for the whole context again, so without it a long item pays for
    // its text once per iteration.
    { role: "user", content: [{ type: "text", text: ratingUserMessage(text, claims, source), cache_control: { type: "ephemeral" } }] },
  ];
  const cost = emptyTokenCost();
  let webSearches = 0;
  let cachedInputTokens = 0;
  // A strict json_schema response_format next to a server-side tool garbles
  // Opus output, so we ask for JSON in the prompt and parse it ourselves. That
  // is the same workaround the native search path of simple-bot uses.
  const output = await parseJsonWithRetry<RatingOutput>({
    source: "rateClaims",
    messages,
    schemaHint: RATING_SCHEMA_HINT,
    call: async (msgs) => {
      const response: any = await llm.create({
        model: CLAIM_RATING_MODEL,
        messages: msgs,
        tools: [
          { ...WEB_SEARCH_TOOL, max_uses: MAX_SEARCHES_PER_ITEM },
          webFetchNativeTool({ maxUses: MAX_FETCHES_PER_ITEM, maxContentTokens: MAX_TOKENS_PER_FETCHED_PAGE }),
        ],
        reasoning_effort: RATING_REASONING_EFFORT,
      } as any);
      addTokenCost(cost, extractOpenRouterCost(response));
      webSearches += response.usage?.server_tool_use_details?.web_search_requests ?? 0;
      cachedInputTokens += response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const raw = response.choices?.[0]?.message?.content ?? "";
      return { toParse: extractJsonObject(raw), assistantEcho: raw };
    },
    parse: parseRatingOutput,
  });

  return { claims: applyRatings(claims, output.ratings), research: output.research, cost, webSearches, cachedInputTokens };
}

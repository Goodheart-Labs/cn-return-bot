/**
 * Truth rating for the everything pipeline.
 *
 * Extraction gives us the claims of an item but says nothing about whether they
 * are true. This step rates the claims of one part in one call. The model gets
 * the part's text, the piece's introduction ahead of it as context, and the
 * claims as a numbered JSON object, together with web search, and returns one
 * rating per claim on a seven-level scale.
 * The rating decides which claims get fact-checked.
 *
 * One call for a whole part is deliberate. The claims of one topic are
 * correlated, and a single good source often settles most of them. A search per
 * claim cannot see that. That is what the per-claim fact-check already does.
 *
 * The research runs on Meta's own search tooling, through OpenRouter's
 * web_search server tool (GOO-258). Inside the one request Meta searches, opens
 * pages and writes the answer, so no loop runs on our side. Meta decides how many
 * searches to run; there is no per-part budget, and the daily spend cap is the
 * bound.
 */

import { claimCheckFields } from "./claimCheckFields";
import { EVERYTHING_MODEL } from "./model";
import { llm } from "../../pipeline/llm/llm";
import { jsonSchemaResponseFormat } from "../../pipeline/prompts/responseFormat";
import { OPENROUTER_NATIVE_WEB_SEARCH_TOOL, stripBrowserLineCitations } from "../../pipeline/tool-calling/tools";
import { parseJsonWithRetry } from "../../pipeline/utils/jsonLlmCall";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../../pipeline/cost-tracking/pricing";
import type { ExtractedClaim, ItemSource, RatedClaim } from "../types";

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

/** The judgement a claim the extractor marked very confident is stored with.
 *  It never reaches the rater, so this is the rater's top rating applied by
 *  the extractor's confidence instead. */
export const VERY_CONFIDENT_JUDGEMENT = "certainly true";

const RATING_SCHEMA_HINT = `{ "research": string, "ratings": [{ "claim": number, "rating": string }] }`;

const RATING_RESPONSE_FORMAT = jsonSchemaResponseFormat("claim_ratings", {
  type: "object",
  properties: {
    research: { type: "string" },
    ratings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "integer" },
          rating: { type: "string", enum: [...JUDGEMENTS] },
        },
        required: ["claim", "rating"],
        additionalProperties: false,
      },
    },
  },
  required: ["research", "ratings"],
  additionalProperties: false,
});

const RATING_SYSTEM_PROMPT = `You rate how true the factual claims of a text are. You get one part of an article or transcript, possibly with the piece's introduction ahead of it for context, and the claims extracted from that part as a JSON object keyed by claim number. Each claim is the author's own words, with the passage it sits in.

Research first. Search the web for sources on the events, people and figures the text is about, and open the most relevant pages to read them in full. Related claims usually share a source, so read the few pages that settle many claims at once. Search before you rate.

Then rate EVERY numbered claim on this scale: ${JUDGEMENTS.join(", ")}. Rate from the evidence you found plus your own knowledge. Use "uncertain" only when nothing you found bears on the claim. A claim rated uncertain or worse is sent to a costly fact-check, so be as decisive as the evidence allows.

Rate the claim as stated, not its gist. A claim is true only if its names, numbers, dates and attributions are right. If the substance holds but the claim names the wrong person, source or figure, it is false: that wrong detail is exactly what a note would correct.

When you are done researching, answer with JSON:
- research: a dense summary of what you found, with the full https:// URL of each source inline.
- ratings: one entry per claim number.`;

export interface RateClaimsParams {
  /** The part's text, in the form the item's full_text is stored in. */
  text: string;
  /** The piece's introduction, shown ahead of the part as context. Null for the
   *  introduction's own part and for an unsplit item. */
  introduction: string | null;
  claims: ExtractedClaim[];
  source: ItemSource;
}

// The rater sees each claim exactly as the fact-check will see it, keyed by its
// number in the list. The number is what the model answers with.
function ratingUserMessage(params: RateClaimsParams): string {
  const numbered = Object.fromEntries(params.claims.map((c, i) => [i + 1, claimCheckFields(c, params.source)]));
  const intro = params.introduction ? `Introduction (context only):\n\n${params.introduction}\n\n` : "";
  return `${intro}Part:\n\n${params.text}\n\nClaims:\n${JSON.stringify(numbered, null, 1)}`;
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
  /** How many searches Meta ran. The pages it opened inside them are not reported. */
  webSearches: number;
}

export async function rateClaims(params: RateClaimsParams): Promise<ClaimRatingResult> {
  if (params.claims.length === 0) return { claims: [], research: "", cost: emptyTokenCost(), webSearches: 0 };

  const messages: any[] = [
    { role: "system", content: RATING_SYSTEM_PROMPT },
    { role: "user", content: ratingUserMessage(params) },
  ];
  const cost = emptyTokenCost();
  let webSearches = 0;
  // The first attempt does the research. A retry only asks for clean JSON over
  // the conversation so far, without the search tool, so the research is never
  // paid for twice.
  const output = await parseJsonWithRetry<RatingOutput>({
    source: "rateClaims",
    messages,
    schemaHint: RATING_SCHEMA_HINT,
    call: async (msgs, attempt) => {
      const response: any = await llm.create({
        model: EVERYTHING_MODEL,
        messages: msgs,
        response_format: RATING_RESPONSE_FORMAT,
        ...(attempt === 1 ? { tools: [OPENROUTER_NATIVE_WEB_SEARCH_TOOL] } : {}),
      } as any);
      addTokenCost(cost, extractOpenRouterCost(response));
      webSearches += response.usage?.server_tool_use_details?.web_search_requests ?? 0;
      const content: string = response.choices?.[0]?.message?.content ?? "";
      // Muse narrates its research steps before the JSON even under a schema,
      // so the object is extracted rather than parsed whole.
      return { toParse: extractJsonObject(content), assistantEcho: content };
    },
    parse: parseRatingOutput,
  });

  return { claims: applyRatings(params.claims, output.ratings), research: stripBrowserLineCitations(output.research), cost, webSearches };
}

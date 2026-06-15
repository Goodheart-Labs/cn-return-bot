/**
 * The cheap Grok pre-filter: given only a tweet URL, decide whether the post
 * needs a Community Note.
 *
 * Uses xAI's Agent Tools API (via the Vercel AI SDK) so Grok can natively:
 *   - x_search    — search X / fetch the post and surrounding context
 *                   (image + video understanding of the post's media)
 *   - web_search  — Google-style web + news search for fact-checks
 * All in one call. (xAI's old `search_parameters` Live Search returns 410 now;
 * `view_image`/`view_x_video` aren't valid top-level tools — media
 * understanding is handled by the enable*Understanding flags below.)
 *
 * The Vercel SDK doesn't pair structured output with tool use cleanly, so we
 * describe the JSON schema in the prompt and JSON.parse the result — the same
 * pattern as src/pipeline/llm/xai.ts.
 *
 * Two prompt versions:
 *   - "neutral": just asks whether a note is needed.
 *   - "lenient": same, but told to lean towards "yes" when unsure (optimises
 *     for a low false-negative rate vs. simple-bot's wants_note decisions).
 */
import { generateText } from "ai";
import { xai } from "../../pipeline/llm/xai";
import { calculateGrokCost, type TokenCost } from "../../pipeline/cost-tracking/pricing";

export const GROK_MODEL = "grok-4.3";

export type PromptVersion = "neutral" | "lenient";

// Short, principle-based definition of "needs a note" — no eval-specific tells.
const SYSTEM_PROMPT =
  "You decide whether an X (Twitter) post needs a Community Note. A note is " +
  "warranted when the post makes a claim that is false, misleading, missing " +
  "crucial context, or pairs real media with a wrong caption/date/location — " +
  "something a correction backed by a trustworthy source could fix. Pure " +
  "opinion, jokes, and clearly-labelled satire do not need a note. Use your " +
  "tools to read the post (and its image/video) and search X, the web, and " +
  "news to check the claims.";

const RESPONSE_SCHEMA = { needs_note: "boolean", reason: "string (one sentence)" };

function userPrompt(tweetUrl: string, version: PromptVersion): string {
  const lean = version === "lenient" ? " Lean towards yes if you are unsure." : "";
  return (
    `Does this post need a Community Note?${lean}\n${tweetUrl}\n\n` +
    `Respond with strict JSON only: ${JSON.stringify(RESPONSE_SCHEMA)}`
  );
}

function buildTools() {
  return {
    x_search: xai.tools.xSearch({
      enableImageUnderstanding: true,
      enableVideoUnderstanding: true,
    }) as any,
    web_search: xai.tools.webSearch({ enableImageUnderstanding: true }) as any,
  };
}

/** Grok returns needs_note as a real boolean or the string "true"/"false". */
export function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return null;
}

/** Grok sometimes wraps the JSON in markdown/asterisks — extract the object. */
function parseDecision(text: string): { needsNote: boolean | null; reason: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return { needsNote: coerceBool(parsed.needs_note), reason: parsed.reason ?? "" };
    } catch {
      // fall through
    }
  }
  return { needsNote: null, reason: "" };
}

export interface FilterResult {
  needsNote: boolean | null; // null on parse/API failure
  reason: string;
  searchCalls: number; // x_search + web_search tool calls
  citations: string[];
  inputTokens: number;
  outputTokens: number;
  cost: TokenCost | null;
  rawText: string;
  error?: string;
}

function collectCitations(sources: any[]): string[] {
  const urls = new Set<string>();
  for (const s of sources ?? []) if (s?.url) urls.add(s.url);
  return [...urls];
}

export async function grokNeedsNote(
  tweetUrl: string,
  version: PromptVersion,
): Promise<FilterResult> {
  try {
    const result: any = await generateText({
      model: xai.responses(GROK_MODEL) as any,
      system: SYSTEM_PROMPT,
      prompt: userPrompt(tweetUrl, version),
      tools: buildTools(),
    });

    const text: string = result.text ?? "";
    const { needsNote, reason } = parseDecision(text);

    const searchCalls: number =
      result.steps?.reduce(
        (n: number, s: any) =>
          n +
          (s.toolCalls?.filter(
            (tc: any) => tc.toolName === "x_search" || tc.toolName === "web_search",
          ).length ?? 0),
        0,
      ) ?? 0;

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;

    return {
      needsNote,
      reason,
      searchCalls,
      citations: collectCitations(result.sources),
      inputTokens,
      outputTokens,
      cost: calculateGrokCost(inputTokens, outputTokens, searchCalls, GROK_MODEL),
      rawText: text,
    };
  } catch (err: any) {
    return {
      needsNote: null,
      reason: "",
      searchCalls: 0,
      citations: [],
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
      rawText: "",
      error: err?.message?.slice(0, 400) ?? String(err),
    };
  }
}

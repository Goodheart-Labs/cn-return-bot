/**
 * Source-selection step (variants 3 & 4 only). Sits between the SearXNG fetch
 * and the analyzer: given the post + all search-result snippets, pick the URLs
 * worth reading in FULL. Picks several relevant sources that cover different
 * angles, while avoiding multiple near-duplicates of the same story/outlet.
 * Runs on deepseek-v4-flash.
 */
import { getBotConfig } from "../../pipeline/ab-testing/botConfig";
import { runJsonLlmCall } from "../../pipeline/utils/jsonLlmCall";

export interface Candidate {
  url: string;
  title: string;
  snippet: string;
}

const SYSTEM_PROMPT = `You are selecting which web pages to read in full to fact-check a social-media post.

You get the post and a numbered list of search results (title, URL, snippet). Select the URLs most useful for verifying the post's factual claims.

Rules:
- Pick sources that are clearly relevant to the post's checkable claims.
- Prefer a diverse set: cover different claims / angles / outlets.
- Do NOT pick multiple results that obviously have near-identical content (same story from the same outlet, syndicated copies, duplicates) — one of each is enough.
- Skip results that are irrelevant, off-topic, or pure SEO/listicle noise.
- Prefer primary sources and authoritative outlets over aggregators when they cover the same fact.

Return JSON only: {"urls": ["...", "..."]} — the exact URLs you selected (a handful, not all of them).`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "selected_sources",
    strict: true,
    schema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
      },
      required: ["urls"],
      additionalProperties: false,
    },
  },
};

/** Pick the relevant/diverse subset of candidate URLs (capped at maxUrls). Only
 *  URLs that appear in the candidate list are kept (guards against model
 *  hallucinating a URL). */
export async function selectSources(
  postContext: string,
  candidates: Candidate[],
  maxUrls: number,
): Promise<string[]> {
  const model = getBotConfig().search_model ?? getBotConfig().model;
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.title}\n   ${c.url}\n   ${c.snippet}`)
    .join("\n\n");
  const userMessage = `## Post\n${postContext}\n\n## Search results\n${list}`;
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userMessage },
  ];
  const parsed = await runJsonLlmCall<{ urls: string[] }>({
    costName: "deepseek_filter.source_select",
    model,
    messages,
    responseFormat: RESPONSE_FORMAT,
    schemaHint: `{ "urls": string[] }`,
  });

  const valid = new Set(candidates.map((c) => c.url));
  const selected: string[] = [];
  for (const u of parsed.urls ?? []) {
    if (valid.has(u) && !selected.includes(u)) selected.push(u);
    if (selected.length >= maxUrls) break;
  }
  return selected;
}

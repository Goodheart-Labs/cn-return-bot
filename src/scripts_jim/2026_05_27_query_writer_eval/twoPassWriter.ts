/**
 * Two-pass query writer.
 *
 * Pass 1: model writes ONE broad orientation query and one fact-check query.
 *         These run through searxng and the top results' titles + snippets
 *         are fed back to the model.
 * Pass 2: model writes 2 targeted queries given what the orientation surfaced.
 *
 * Total per row: 2 LLM calls + 4 searches (1 orientation + 1 fc + 2 targeted).
 * The first two passes share the search cache with single-pass variants.
 */

import { llm } from "../../pipeline/llm/llm";
import { searchSearxng, type SearxResult } from "./evalHarness";

const MODEL = "deepseek/deepseek-v4-flash";

const PASS1_SYSTEM = `You are starting a fact-check of a tweet you have just seen for the first time. You don't know what the correction is yet — you need to RESEARCH first.

Write **exactly 2 search queries**:
- Q1 (orientation): a broad query naming the most distinctive entity + topic, designed to find ANY coverage of the situation (news, blog, fact-check, social). Pretend you're a journalist who just heard the claim and wants to find context. NO quotes.
- Q2 (counter-frame fact-check): the same keywords plus exactly one of these tokens — \`hoax\`, \`debunked\`, \`fake\`, \`fact check\`, \`alive\` (for death claims), \`real or AI\` (for image claims), \`snopes\`, \`politifact\`, \`lead stories\`. Designed to surface a fact-check if one exists.

Hard rules:
- No \`site:\` operators.
- At most one short quoted phrase per query.
- If the post is pure opinion or has no checkable entity, return {"queries":[]}.

Return JSON: {"queries":["<orientation>", "<counter-frame>"]}`;

const PASS2_SYSTEM = `You already ran 2 orientation queries on this tweet and saw the top results below.

Now write **2 more targeted queries** to fill in gaps. Look at what the orientation surfaced and ask:
- What angle is missing? (Primary source? Specific outlet's coverage? Different fact-checker? Date-anchored coverage?)
- Did the orientation hit social-media echo only? If so, add an outlet-specific query.
- Did the orientation hit one fact-checker but maybe a different angle? Add a different fact-checker brand.

Hard rules:
- No \`site:\` operators.
- At most one short quoted phrase per query.
- New queries should NOT be near-duplicates of the orientation queries.
- Lean on entities that ALSO appear in the orientation snippets — they're confirmed real.

Return JSON: {"queries":["<targeted-1>", "<targeted-2>"]}`;

interface Pass1Result {
  queries: string[];
  results_per_query: Array<{ query: string; results: SearxResult[] }>;
}

function fmtSnippets(perQ: Array<{ query: string; results: SearxResult[] }>, maxPerQuery = 5): string {
  const parts: string[] = [];
  for (const q of perQ) {
    parts.push(`\nQuery: ${q.query}`);
    if (q.results.length === 0) {
      parts.push("  (no results)");
      continue;
    }
    for (const r of q.results.slice(0, maxPerQuery)) {
      const snip = (r.content ?? "").slice(0, 150).replace(/\s+/g, " ");
      parts.push(`  - ${r.title}  [${r.url}]`);
      if (snip) parts.push(`    ${snip}`);
    }
  }
  return parts.join("\n");
}

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "queries",
    strict: true,
    schema: {
      type: "object",
      properties: { queries: { type: "array", items: { type: "string" } } },
      required: ["queries"],
      additionalProperties: false,
    },
  },
};

export async function twoPassWrite(userMessage: string): Promise<{
  queries: string[];
  pass1_queries: string[];
  pass2_queries: string[];
}> {
  // Pass 1
  const r1 = await llm.create({
    model: MODEL,
    messages: [
      { role: "system", content: PASS1_SYSTEM },
      { role: "user", content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  const c1 = r1.choices?.[0]?.message?.content ?? "{}";
  const p1 = JSON.parse(c1).queries ?? [];
  if (p1.length === 0) {
    return { queries: [], pass1_queries: [], pass2_queries: [] };
  }

  // Search pass-1 queries
  const perQ: Array<{ query: string; results: SearxResult[] }> = [];
  for (const q of p1) {
    try {
      const { results } = await searchSearxng(q);
      perQ.push({ query: q, results });
    } catch {
      perQ.push({ query: q, results: [] });
    }
  }

  // Pass 2 — give model the snippets so it can target the gap.
  const pass2User =
    `Original post:\n\n${userMessage}\n\n` +
    `## Orientation results so far\n${fmtSnippets(perQ)}\n\n` +
    `Now write 2 targeted queries that fill the gaps.`;
  const r2 = await llm.create({
    model: MODEL,
    messages: [
      { role: "system", content: PASS2_SYSTEM },
      { role: "user", content: pass2User },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  const c2 = r2.choices?.[0]?.message?.content ?? "{}";
  const p2 = JSON.parse(c2).queries ?? [];

  return {
    queries: [...p1, ...p2],
    pass1_queries: p1,
    pass2_queries: p2,
  };
}

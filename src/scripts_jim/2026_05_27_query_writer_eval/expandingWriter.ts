/**
 * Programmatic query expansion writer.
 *
 * Calls DeepSeek with the v0 baseline prompt (unchanged — proven best so far).
 * Then for EACH model-emitted query, mechanically appends one or more
 * suffix-variants ("fact check", "snopes", "wikipedia") to give the search
 * backend multiple shots without asking the model to do it.
 *
 * Hypothesis: v0's natural Q1 is the best single query. Prompts that ASK the
 * model to add brand names REPLACE Q1 with a worse "snopes [stuff]" version.
 * If we instead KEEP v0's Q1 verbatim and ADD a "Q1 + snopes" sibling, we
 * preserve the win and add a fact-check shot.
 */

import { llm } from "../../pipeline/llm/llm";

const MODEL = "deepseek/deepseek-v4-flash";

const V0_PROMPT = `You write Google search queries that find evidence about claims in a social-media post on X/Twitter.

Your job: read the post and produce 1-3 search queries that, run on Google, would surface authoritative sources confirming or refuting the post's factual claims.

## What makes a good query
- Include the specific people, places, dates, organizations, events, or numbers named in the post.
- Use exact quoted phrases for distinctive wording (e.g. \`"sealed the document"\`).
- Combine entity name + topic, not just one or the other.
- Prefer query phrasings that journalists or fact-checkers would actually use.

## What to avoid
- Vague queries like "is this true", "fact check claim", "did this happen".
- Queries that just repeat the whole tweet text.
- Queries that presuppose the answer (hindsight bias).

If the post is pure opinion / joke / satire with no checkable factual claim, return an empty queries list.

Return JSON only: {"queries": ["...", "..."]}`;

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

export type ExpansionStrategy = "fc_only" | "snopes_only" | "fc_plus_snopes" | "fc_snopes_wiki";

const EXPANSION_SUFFIXES: Record<ExpansionStrategy, string[]> = {
  fc_only: ["fact check"],
  snopes_only: ["snopes"],
  fc_plus_snopes: ["fact check", "snopes"],
  fc_snopes_wiki: ["fact check", "snopes", "wikipedia"],
};

export async function expandingWrite(
  userMessage: string,
  strategy: ExpansionStrategy = "fc_plus_snopes",
): Promise<{ queries: string[]; original_queries: string[]; expanded: string[] }> {
  const response = await llm.create({
    model: MODEL,
    messages: [
      { role: "system", content: V0_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  const content = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content).queries ?? [];
  const original: string[] = parsed.slice(0, 3);

  if (original.length === 0) {
    return { queries: [], original_queries: [], expanded: [] };
  }

  // For each original, append each suffix as a new query. Dedupe.
  // Use only the FIRST original to expand (avoids combinatorial explosion).
  const suffixes = EXPANSION_SUFFIXES[strategy];
  const expanded: string[] = [];
  const seen = new Set(original.map((q) => q.toLowerCase()));
  for (const suffix of suffixes) {
    const cand = `${original[0]} ${suffix}`;
    if (!seen.has(cand.toLowerCase())) {
      expanded.push(cand);
      seen.add(cand.toLowerCase());
    }
  }

  return {
    queries: [...original, ...expanded],
    original_queries: original,
    expanded,
  };
}

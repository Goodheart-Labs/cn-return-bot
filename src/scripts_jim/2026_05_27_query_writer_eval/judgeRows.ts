/**
 * Reusable LLM judge for query-writer eval rows.
 *
 * Separated from the standalone llmJudge.ts so the eval harness can invoke
 * it inline without spawning a subprocess.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { llm } from "../../pipeline/llm/llm";
import type { RowResult } from "./evalHarness";

const MODEL = "deepseek/deepseek-v4-flash";
const MAX_RESULTS_PER_ROW = 12;

const SYSTEM_PROMPT = `You decide whether a set of search results contains a URL that would be a sufficient source for a Community-Notes correction.

You will see:
1. The original X/Twitter post (the claim being checked).
2. The reference correction text (what a good Community Note says).
3. A list of search-result titles + URLs + snippets that an automated query writer's queries surfaced.

Your job: does the search result set contain AT LEAST ONE URL that a fact-checker could reasonably cite to support the reference correction?

Be PRACTICAL:
- A different outlet covering the same story is fine (AP instead of Reuters, NBC affiliate instead of NBC News).
- A general Wikipedia article on the topic counts if it would clearly disprove the claim.
- A primary source (court filing, official press release, archived original post) is gold-standard.
- A fact-check that already debunks the claim is gold-standard.

Be STRICT:
- A page that only TANGENTIALLY mentions the topic doesn't count.
- A page that AMPLIFIES the claim (the hoax site itself) doesn't count.
- A page that's just a category/listing page without specific coverage doesn't count.

Return JSON:
{
  "sufficient": true | false,
  "best_url": "<the URL most relevant to the correction, or empty>",
  "reasoning": "<one sentence>"
}`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "judge",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sufficient: { type: "boolean" },
        best_url: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["sufficient", "best_url", "reasoning"],
      additionalProperties: false,
    },
  },
};

export interface JudgeVerdict {
  tweet_id: string;
  sufficient: boolean;
  best_url?: string;
  reasoning: string;
  errored?: boolean;
}

interface DatasetRow {
  tweet_id: string;
  tweet_text: string;
  reference_note: string;
  judge_guidance: string;
}

function loadDataset(): Map<string, DatasetRow> {
  const p = path.join(__dirname, "../../../datasets/query_writer_eval/all_candidates.jsonl");
  const rows = fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return new Map(rows.map((r: any) => [r.tweet_id, r]));
}

let datasetCache: Map<string, DatasetRow> | null = null;
function dataset(): Map<string, DatasetRow> {
  if (!datasetCache) datasetCache = loadDataset();
  return datasetCache;
}

function buildUserMessage(row: DatasetRow, r: RowResult): string {
  const parts: string[] = [];
  parts.push("## Original post");
  parts.push(row.tweet_text);
  parts.push("");
  parts.push("## Reference correction");
  parts.push(row.reference_note);
  parts.push("");
  if (row.judge_guidance) {
    parts.push("## What a sufficient correction must establish");
    parts.push(row.judge_guidance);
    parts.push("");
  }
  parts.push("## Search results returned by the bot's queries");
  parts.push(`Queries: ${r.queries.join(" | ")}`);
  parts.push("");
  const seen = new Set<string>();
  let i = 0;
  outer: for (const q of r.per_query) {
    for (const res of q.results) {
      if (seen.has(res.url)) continue;
      seen.add(res.url);
      i++;
      if (i > MAX_RESULTS_PER_ROW) break outer;
      const snippet = (res.content ?? "").slice(0, 240).replace(/\s+/g, " ");
      parts.push(`${i}. ${res.title}`);
      parts.push(`   ${res.url}`);
      parts.push(`   ${snippet}`);
    }
  }
  if (i === 0) parts.push("(no results)");
  parts.push("");
  parts.push('Return JSON: {"sufficient":<bool>,"best_url":"<url>","reasoning":"<one sentence>"}');
  return parts.join("\n");
}

export async function judgeOne(r: RowResult): Promise<JudgeVerdict> {
  const ds = dataset().get(r.tweet_id);
  if (!ds) return { tweet_id: r.tweet_id, sufficient: false, reasoning: "no dataset row" };
  if (r.queries.length === 0) return { tweet_id: r.tweet_id, sufficient: false, reasoning: "no queries" };
  const total = r.per_query.reduce((n, q) => n + q.results.length, 0);
  if (total === 0) return { tweet_id: r.tweet_id, sufficient: false, reasoning: "no search results" };

  try {
    const response = await llm.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(ds, r) },
      ],
      response_format: RESPONSE_FORMAT,
    } as any);
    const content = response.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    return {
      tweet_id: r.tweet_id,
      sufficient: !!parsed.sufficient,
      best_url: parsed.best_url,
      reasoning: parsed.reasoning,
    };
  } catch (e: any) {
    return {
      tweet_id: r.tweet_id,
      sufficient: false,
      reasoning: `judge error: ${e?.message ?? e}`,
      errored: true,
    };
  }
}

export async function judgeAllRows(rows: RowResult[], concurrency = 6): Promise<JudgeVerdict[]> {
  const queue = new PQueue({ concurrency });
  const out: JudgeVerdict[] = new Array(rows.length);
  let done = 0;
  await Promise.all(
    rows.map((r, i) =>
      queue.add(async () => {
        out[i] = await judgeOne(r);
        done++;
        if (done % 10 === 0 || done === rows.length) {
          const pass = out.filter((v) => v?.sufficient).length;
          console.log(`  judge ${done}/${rows.length} pass=${pass}`);
        }
      })
    )
  );
  return out;
}

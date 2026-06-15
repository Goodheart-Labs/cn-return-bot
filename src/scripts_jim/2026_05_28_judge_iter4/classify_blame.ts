/**
 * For each row in judge_analysis_dump.json, use a Sonnet call to decide:
 * was the failure primarily a JUDGE mistake or a WRITER mistake (or both)?
 *
 * The decision is grounded in the strict big_eval judge_guidance + the
 * ground_truth_note. Sonnet reads the tweet, the iter-4 writer's note, the
 * judge_guidance, the iter-4 judge verdict + reasoning, and decides whether
 * the writer's note actually meets the strict PASS criteria — and how that
 * intersects with what the iter-4 judge did.
 *
 * Output: same JSON shape but every entry has a `blame` field and the file
 * adds split sections (judge_mistakes, writer_mistakes, both) for each bucket.
 */
import "dotenv/config";
import * as fs from "fs";
import { llm } from "../../pipeline/llm/llm";

const SONNET = "anthropic/claude-sonnet-4-6";
const IN = "src/scripts_jim/2026_05_28_judge_iter4/judge_analysis_dump.json";
const OUT = "src/scripts_jim/2026_05_28_judge_iter4/judge_analysis_dump_classified.json";

interface Entry {
  url: string;
  needs_note: string;
  ground_truth_note: string;
  judge_guidance: string;
  original_failed_note: string;
  failure_reason: string;
  tweet_text: string;
  iter4_writer_note: string;
  iter4_writer_sources: string[];
  iter4_judge_verdict: boolean | null;
  iter4_judge_reasoning: string;
  new_judge_verdict: boolean | null;
  new_judge_reasoning: string;
  classification: string;
  why_in_bucket: string;
  blame?: BlameDecision;
}

interface BlameDecision {
  primary_blame: "judge" | "writer" | "both";
  writer_note_meets_guidance: boolean;
  reasoning: string;
}

interface Dump {
  summary: any;
  bucket_a_current_judge_mistakes: Entry[];
  bucket_b_regressions_vs_new: Entry[];
}

function buildPrompt(e: Entry): string {
  const isMiss = e.needs_note === "yes";
  return [
    `You are reviewing a Community Notes failure case to assign primary blame. There is a writer (which composes a note) and a downstream judge (which decides whether to publish). Both may fail. Your job: decide whether the failure here was primarily a WRITER mistake or a JUDGE mistake (or both).`,
    ``,
    `## Ground truth`,
    `needs_note = ${e.needs_note}    (yes = a good community note SHOULD exist; no = no note should be published)`,
    `Ground truth note (an example of a good note for this tweet, if applicable):`,
    e.ground_truth_note || "(none — no note should be published)",
    ``,
    `## Judge guidance (strict criteria for what a PASSING note must do for this tweet)`,
    e.judge_guidance || "(none)",
    e.original_failed_note ? `\n## A PRIOR note that was rated NOT HELPFUL on this tweet${e.failure_reason ? ` (${e.failure_reason})` : ""}:\n"${e.original_failed_note}"\nThe writer must NOT repeat that failure.` : "",
    ``,
    `## Tweet text`,
    e.tweet_text,
    ``,
    `## What our writer produced`,
    e.iter4_writer_note ? `Note: "${e.iter4_writer_note}"\nSources: ${e.iter4_writer_sources.join(", ") || "(none)"}` : `(writer returned empty — no note proposed)`,
    ``,
    `## What our current production judge decided`,
    `verdict: ${e.iter4_judge_verdict === null ? "n/a" : e.iter4_judge_verdict ? "PUBLISH" : "REJECT"}`,
    `reasoning: ${e.iter4_judge_reasoning || "(none recorded)"}`,
    ``,
    `## Classification context`,
    isMiss
      ? `This is a MISS case — ground truth says a note should exist, but iter-4's pipeline didn't end up publishing one. Either the writer wrote something that doesn't meet the strict judge_guidance criteria (writer mistake), or the writer's note DOES meet the criteria but the judge wrongly rejected it (judge mistake).`
      : `This is a FALSE POSITIVE case — ground truth says no note should exist, but iter-4 wrote and published one. Either the writer hallucinated / wrote a note that shouldn't exist (writer mistake), or the writer's note technically meets writing criteria but the underlying tweet is satire/joke/opinion that the judge should have caught (judge mistake).`,
    ``,
    `## Decide`,
    `1. Does the iter-4 writer's note actually meet the strict judge_guidance criteria? (true/false)`,
    `2. Primary blame: "writer" if the writer's output was the root cause of the failure (bad note, hallucinated, missing required content, etc.). "judge" if the writer's output was reasonable but the judge made the wrong call. "both" only if BOTH stages have an independent, equally serious failure.`,
    `3. Reasoning: 2-3 sentences explaining your call. Reference specific phrases from judge_guidance.`,
    ``,
    `Return JSON: {"writer_note_meets_guidance": bool, "primary_blame": "writer"|"judge"|"both", "reasoning": string}`,
  ].join("\n");
}

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "blame",
    strict: true,
    schema: {
      type: "object",
      properties: {
        writer_note_meets_guidance: { type: "boolean" },
        primary_blame: { type: "string", enum: ["writer", "judge", "both"] },
        reasoning: { type: "string" },
      },
      required: ["writer_note_meets_guidance", "primary_blame", "reasoning"],
      additionalProperties: false,
    },
  },
};

async function classify(e: Entry): Promise<BlameDecision> {
  const resp = await llm.create({
    model: SONNET,
    temperature: 1,
    messages: [{ role: "user", content: buildPrompt(e) }],
    response_format: SCHEMA,
    // @ts-expect-error OpenRouter extended thinking
    reasoning: { effort: "low" },
  } as any);
  const content = resp.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content) as BlameDecision;
}

async function classifyAll(entries: Entry[], label: string): Promise<void> {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    try {
      e.blame = await classify(e);
      console.log(`[${label} ${i + 1}/${entries.length}] ${e.url.replace(/^.*status\//, "")} → ${e.blame.primary_blame}  (writer_meets_guidance=${e.blame.writer_note_meets_guidance})`);
    } catch (err: any) {
      console.log(`[${label} ${i + 1}/${entries.length}] ${e.url} ERR: ${err?.message}`);
    }
  }
}

async function main(): Promise<void> {
  const dump: Dump = JSON.parse(fs.readFileSync(IN, "utf8"));

  console.log(`Classifying bucket A (${dump.bucket_a_current_judge_mistakes.length} entries)...`);
  await classifyAll(dump.bucket_a_current_judge_mistakes, "A");
  console.log(`Classifying bucket B (${dump.bucket_b_regressions_vs_new.length} entries)...`);
  await classifyAll(dump.bucket_b_regressions_vs_new, "B");

  function split(entries: Entry[]) {
    return {
      judge_mistakes: entries.filter((e) => e.blame?.primary_blame === "judge"),
      writer_mistakes: entries.filter((e) => e.blame?.primary_blame === "writer"),
      both: entries.filter((e) => e.blame?.primary_blame === "both"),
      unclassified: entries.filter((e) => !e.blame),
    };
  }

  const out = {
    summary: {
      bucket_a_split: {
        judge: dump.bucket_a_current_judge_mistakes.filter((e) => e.blame?.primary_blame === "judge").length,
        writer: dump.bucket_a_current_judge_mistakes.filter((e) => e.blame?.primary_blame === "writer").length,
        both: dump.bucket_a_current_judge_mistakes.filter((e) => e.blame?.primary_blame === "both").length,
        total: dump.bucket_a_current_judge_mistakes.length,
      },
      bucket_b_split: {
        judge: dump.bucket_b_regressions_vs_new.filter((e) => e.blame?.primary_blame === "judge").length,
        writer: dump.bucket_b_regressions_vs_new.filter((e) => e.blame?.primary_blame === "writer").length,
        both: dump.bucket_b_regressions_vs_new.filter((e) => e.blame?.primary_blame === "both").length,
        total: dump.bucket_b_regressions_vs_new.length,
      },
    },
    bucket_a_current_judge_mistakes_split: split(dump.bucket_a_current_judge_mistakes),
    bucket_b_regressions_vs_new_split: split(dump.bucket_b_regressions_vs_new),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log(`\n=== Summary ===`);
  console.log(JSON.stringify(out.summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

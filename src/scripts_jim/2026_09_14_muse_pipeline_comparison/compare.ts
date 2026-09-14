/**
 * GOO-159: what does the everything pipeline on Muse make of an item the old
 * pipeline already processed?
 *
 * READ-ONLY against prod. It loads one item's stored text, claims, notes,
 * sources and check runs, runs the new pipeline steps in-process on the same
 * inputs, and writes six JSON files, old and new for each of the three steps.
 * Each pair carries the identical input so the two outputs line up:
 *
 *   extraction   input: the stored full text        new: gate + split + Muse extraction
 *   rating       input: the stored claims + text     new: Muse rating of the OLD claims
 *   check        input: the stored checked claims    new: Muse check of the SAME claims
 *
 * Nothing is written to the database.
 *
 *   bun run src/scripts_jim/2026_09_14_muse_pipeline_comparison/compare.ts [<item-id>] [--steps extraction,rating,check]
 *
 * Results land in results-decker/<item-id>/ next to this script.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import PQueue from "p-queue";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaimPost, runClaimCheck } from "../../everything/pipeline/checkClaims";
import { extractClaims } from "../../everything/pipeline/extractClaims";
import { rateClaims, shouldFactCheck } from "../../everything/pipeline/rateClaims";
import type { ExtractedClaim, ItemSource } from "../../everything/types";
import { aggregateAndLogCosts, withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { closeBrowser } from "../../pipeline/utils/browserManager";

/** The shared client reads OPENROUTER_API_KEY and builds itself lazily on the
 *  first call, so reassigning the variable here is enough to redirect it. */
if (process.env.OPENROUTER_TESTING_KEY) {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  console.log("Using OPENROUTER_TESTING_KEY for OpenRouter calls.\n");
}

// Nicholas Decker, "The Consequences of Caste in Village India": 181 claims,
// 24 checked, 2 notes both rated helpful.
const DEFAULT_ITEM = "8764d17a-b65c-4789-b0d7-99339f69260f";
const EXTRACTION_CONCURRENCY = 3;
const CHECK_CONCURRENCY = 3;
const ALL_STEPS = ["extraction", "rating", "check"] as const;
type Step = (typeof ALL_STEPS)[number];

function parseArgs(): { itemId: string; steps: Step[] } {
  const args = process.argv.slice(2);
  const stepsIdx = args.indexOf("--steps");
  const steps = stepsIdx === -1 ? [...ALL_STEPS] : (args[stepsIdx + 1]!.split(",") as Step[]);
  const itemId = args.find((a, i) => !a.startsWith("--") && i !== stepsIdx + 1) ?? DEFAULT_ITEM;
  return { itemId, steps };
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface ClaimRow {
  id: string;
  claim: string;
  judgement: string;
  status: string;
  status_reason: string | null;
  context_quote: string | null;
  context_paragraph: string | null;
  image_urls: string[];
}

interface StoredCheck {
  /** The full run log, the same shape everything_pipeline_runs.logs stores. */
  logs: unknown;
  outcome: string;
  outcome_reason: string | null;
  final_stage: string | null;
  cost: number;
  findings: string | null;
  /** The note the writer drafted, whether or not it survived verification. */
  noteDraft: string | null;
  /** The source verifier's verdict (YES/NO) and its last reply. */
  verifier: { result: string | null; reply: string | null };
  note: string | null;
  sources: { url: string; quote: string | null; explanation: string | null }[];
}

async function loadItem(itemId: string) {
  const { data: item, error } = await db
    .from("everything_items")
    .select("id,title,source,url,published_at,full_text")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error(`item ${itemId}: ${error?.message ?? "not found"}`);
  if (!item.full_text) throw new Error("item has no stored text");
  const { data: claims } = await db
    .from("everything_claims")
    .select("id,claim,judgement,status,status_reason,context_quote,context_paragraph,image_urls")
    .eq("item_id", itemId)
    .is("created_by", null)
    .order("created_at");
  const rows = (claims ?? []) as ClaimRow[];
  const claimIds = rows.map((r) => r.id);
  const { data: notes } = await db.from("everything_notes").select("id,claim_id,note").in("claim_id", claimIds).is("author_id", null);
  const { data: sources } = await db
    .from("everything_note_sources")
    .select("note_id,url,quote,explanation,sort_order")
    .in("note_id", (notes ?? []).map((n) => n.id))
    .order("sort_order");
  const { data: runs } = await db
    .from("everything_pipeline_runs")
    .select("claim_id,outcome,outcome_reason,final_stage,cost,logs")
    .in("claim_id", claimIds)
    .order("created_at");
  const checks = new Map<string, StoredCheck>();
  for (const run of runs ?? []) {
    const note = (notes ?? []).find((n) => n.claim_id === run.claim_id);
    checks.set(run.claim_id, {
      logs: run.logs,
      outcome: run.outcome,
      outcome_reason: run.outcome_reason,
      final_stage: run.final_stage,
      cost: Number(run.cost ?? 0),
      findings: findingsFrom(run.logs),
      noteDraft: run.logs?.note?.text ?? null,
      verifier: verifierFrom(run.logs),
      note: note?.note ?? null,
      sources: (sources ?? []).filter((s) => s.note_id === note?.id).map(({ url, quote, explanation }) => ({ url, quote, explanation })),
    });
  }
  return { item: { ...item, source: item.source as ItemSource, full_text: item.full_text as string }, rows, checks };
}

/** The search step's findings, wherever the arm put them: the native-search
 *  arms log them as messages.1, the tool loop as messages.final. */
function findingsFrom(logs: any): string | null {
  const messages = logs?.note_writer_steps?.search?.messages;
  return messages?.["1"]?.content?.findings ?? messages?.final?.content?.findings ?? null;
}

/** The verifier's verdict and the last thing it said, whichever flow ran. */
function verifierFrom(logs: any): { result: string | null; reply: string | null } {
  const result = logs?.sourceCheck?.result ?? null;
  const turns = logs?.note_writer_steps?.source_verifier?.turn ?? {};
  const lastTurn = Object.values(turns).at(-1) as any;
  const messages = lastTurn?.messages ?? logs?.note_writer_steps?.source_verifier?.messages ?? {};
  const last = Object.values(messages).at(-1) as any;
  const reply = last?.content ?? null;
  return { result, reply: reply == null ? null : typeof reply === "string" ? reply : JSON.stringify(reply) };
}

function toExtractedClaim(row: ClaimRow, url: string): ExtractedClaim {
  return {
    claim: row.claim,
    context: row.context_quote ?? "",
    contextParagraph: row.context_paragraph ?? "",
    imageUrls: row.image_urls ?? [],
    veryConfidentTrue: false,
  speculation: false,
    anchor: { kind: "substack", url },
  };
}

/** The claim as both files show it, so old and new line up by index. */
function claimView(row: ClaimRow) {
  return { claim: row.claim, context_quote: row.context_quote, context_paragraph: row.context_paragraph, image_urls: row.image_urls };
}

function writeResult(dir: string, name: string, data: unknown) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`  wrote ${name}.json`);
}

type Loaded = Awaited<ReturnType<typeof loadItem>>;

async function compareExtraction(loaded: Loaded, dir: string) {
  const { item, rows } = loaded;
  const input = { itemId: item.id, title: item.title, url: item.url, fullText: item.full_text };
  writeResult(dir, "extraction.old", { step: "extraction", input, output: { claimCount: rows.length, claims: rows.map(claimView) } });

  const startedAt = Date.now();
  const { result, cost } = await withCostTracker(async () => {
    const found = await extractClaims(
      { kind: "substack", url: item.url, title: item.title ?? "", publishedAt: item.published_at ?? undefined, text: item.full_text },
      EXTRACTION_CONCURRENCY,
      true,
    );
    return { result: found, cost: aggregateAndLogCosts() };
  });
  const seconds = (Date.now() - startedAt) / 1000;
  const output =
    result.kind === "not_checkable"
      ? { kind: result.kind, reason: result.reason }
      : {
          kind: result.kind,
          claimCount: result.parts.reduce((n, p) => n + p.claims.length, 0),
          veryConfidentCount: result.parts.reduce((n, p) => n + p.claims.filter((c) => c.veryConfidentTrue).length, 0),
          introduction: result.introduction,
          parts: result.parts.map((p) => ({
            index: p.index,
            title: p.title,
            chars: p.text.length,
            claimCount: p.claims.length,
            veryConfidentCount: p.claims.filter((c) => c.veryConfidentTrue).length,
            claims: p.claims.map(({ claim, context, contextParagraph, imageUrls, veryConfidentTrue, speculation }) => ({
              claim,
              context_quote: context,
              context_paragraph: contextParagraph,
              image_urls: imageUrls,
              very_confident_that_its_true: veryConfidentTrue,
              speculation,
            })),
          })),
        };
  writeResult(dir, "extraction.new", { step: "extraction", input, costUsd: cost?.cost ?? null, seconds, output });
  console.log(`  extraction: ${output.kind === "claims" ? `${output.claimCount} claims in ${output.parts.length} parts, ${output.veryConfidentCount} very confident` : `not checkable (${output.reason})`}, $${(cost?.cost ?? 0).toFixed(3)}, ${seconds.toFixed(0)}s`);
}

async function compareRating(loaded: Loaded, dir: string) {
  const { item, rows } = loaded;
  const input = { itemId: item.id, title: item.title, text: item.full_text, claims: rows.map(claimView) };
  writeResult(dir, "rating.old", {
    step: "rating",
    input,
    output: {
      checkedCount: rows.filter((r) => shouldFactCheck(r.judgement)).length,
      judgements: rows.map((r, i) => ({ claim: i + 1, judgement: r.judgement, checked: shouldFactCheck(r.judgement) })),
    },
  });

  const startedAt = Date.now();
  const rating = await rateClaims({
    text: item.full_text,
    introduction: null,
    claims: rows.map((r) => toExtractedClaim(r, item.url)),
    source: item.source,
  });
  const seconds = (Date.now() - startedAt) / 1000;
  const judgements = rating.claims.map((c, i) => ({
    claim: i + 1,
    judgement: c.judgement,
    checked: shouldFactCheck(c.judgement),
    oldJudgement: rows[i]!.judgement,
  }));
  writeResult(dir, "rating.new", {
    step: "rating",
    input,
    costUsd: rating.cost.cost,
    seconds,
    webSearches: rating.webSearches,
    webFetches: rating.webFetches,
    output: {
      checkedCount: judgements.filter((j) => j.checked).length,
      agreeCount: judgements.filter((j) => j.judgement === j.oldJudgement).length,
      research: rating.research,
      judgements,
    },
  });
  console.log(
    `  rating: ${judgements.filter((j) => j.checked).length} of ${rows.length} to check (was ${rows.filter((r) => shouldFactCheck(r.judgement)).length}), ` +
      `${judgements.filter((j) => j.judgement === j.oldJudgement).length} identical judgements, ${rating.webSearches} searches, ${rating.webFetches} fetches, $${rating.cost.cost.toFixed(3)}, ${seconds.toFixed(0)}s`,
  );
}

async function compareCheck(loaded: Loaded, dir: string) {
  const { item, rows, checks } = loaded;
  const checked = rows.filter((r) => checks.has(r.id));
  const input = { itemId: item.id, title: item.title, publishedAt: item.published_at, claims: checked.map(claimView) };
  writeResult(dir, "check.old", {
    step: "check",
    input,
    costUsd: checked.reduce((s, r) => s + checks.get(r.id)!.cost, 0),
    output: {
      noteCount: checked.filter((r) => checks.get(r.id)!.note).length,
      checks: checked.map((r, i) => ({ claim: i + 1, status: r.status, status_reason: r.status_reason, ...checks.get(r.id)! })),
    },
  });

  const startedAt = Date.now();
  const queue = new PQueue({ concurrency: CHECK_CONCURRENCY });
  const results = await Promise.all(
    checked.map((row, i) =>
      queue.add(async () => {
        const post = buildClaimPost({
          claim: toExtractedClaim(row, item.url),
          source: item.source,
          itemId: item.id,
          index: i,
          publishedAt: item.published_at ?? undefined,
        });
        try {
          const { check, run } = await runClaimCheck(post);
          console.log(`    [${i + 1}/${checked.length}] ${check.kind} (${run.outcome}) $${(run.costUsd ?? 0).toFixed(3)}`);
          return {
            claim: i + 1,
            logs: run.logs,
            outcome: run.outcome,
            outcome_reason: run.outcomeReason,
            final_stage: run.finalStage,
            cost: run.costUsd ?? 0,
            findings: findingsFrom(run.logs),
            noteDraft: (run.logs as any)?.note?.text ?? null,
            verifier: verifierFrom(run.logs),
            note: check.kind === "note" ? check.note : null,
            sources: check.kind === "note" ? check.sources : [],
          };
        } catch (err: any) {
          console.log(`    [${i + 1}/${checked.length}] error: ${err?.message}`);
          return {
            claim: i + 1,
            logs: null,
            outcome: "error",
            outcome_reason: err?.message ?? "unknown",
            final_stage: null,
            cost: 0,
            findings: null,
            noteDraft: null,
            verifier: { result: null, reply: null },
            note: null,
            sources: [],
          };
        }
      }),
    ),
  );
  const seconds = (Date.now() - startedAt) / 1000;
  writeResult(dir, "check.new", {
    step: "check",
    input,
    costUsd: results.reduce((s, r) => s + r!.cost, 0),
    seconds,
    output: { noteCount: results.filter((r) => r!.note).length, checks: results },
  });
  console.log(
    `  check: ${results.filter((r) => r!.note).length} notes from ${checked.length} claims (was ${checked.filter((r) => checks.get(r.id)!.note).length}), ` +
      `$${results.reduce((s, r) => s + r!.cost, 0).toFixed(3)} (was $${checked.reduce((s, r) => s + checks.get(r.id)!.cost, 0).toFixed(3)}), ${seconds.toFixed(0)}s`,
  );
}

async function main() {
  const { itemId, steps } = parseArgs();
  const loaded = await loadItem(itemId);
  console.log(`### ${loaded.item.title} (${loaded.item.source}, ${loaded.rows.length} claims, ${loaded.checks.size} checked, text ${loaded.item.full_text.length} chars)\n`);
  const dir = join(import.meta.dir, "results-decker", itemId);
  mkdirSync(dir, { recursive: true });
  if (steps.includes("extraction")) await compareExtraction(loaded, dir);
  if (steps.includes("rating")) await compareRating(loaded, dir);
  if (steps.includes("check")) await compareCheck(loaded, dir);
}

main()
  .catch((err) => {
    console.error("[compare] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeBrowser();
    } catch {}
  });

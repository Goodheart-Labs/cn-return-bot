/**
 * Puts the old and new check runs of one item into the review dashboard as two
 * dataset uploads, so their full logs can be browsed there. It writes only the
 * dashboard's own tables (review_dashboard_uploads, review_dashboard_items),
 * the same ones the dashboard's Upload button writes; nothing in the pipeline
 * tables changes. An upload can be deleted from the dashboard afterwards.
 *
 *   bun run src/scripts_jim/2026_09_14_muse_pipeline_comparison/uploadToReviewDashboard.ts [<item-id>]
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { csvRowToReviewItemInsert } from "../../dashboard-shared/reviewUpload";
import { claimCheckFields } from "../../everything/pipeline/claimCheckFields";

const DEFAULT_ITEM = "8764d17a-b65c-4789-b0d7-99339f69260f";
const itemId = process.argv[2] ?? DEFAULT_ITEM;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface CheckFile {
  input: { itemId: string; title: string; claims: { claim: string; context_quote: string | null; context_paragraph: string | null; image_urls: string[] }[] };
  output: {
    checks: {
      claim: number;
      logs: unknown;
      outcome: string;
      outcome_reason: string | null;
      note: string | null;
      noteDraft: string | null;
      verifier: { result: string | null; reply: string | null };
      sources: { url: string }[];
    }[];
  };
}

async function upload(name: string, file: CheckFile) {
  const { data: up, error } = await db.from("review_dashboard_uploads").insert({ name, item_count: file.output.checks.length }).select("id").single();
  if (error || !up) throw error ?? new Error("no upload row");
  const rows = file.output.checks.map((check) => {
    const claim = file.input.claims[check.claim - 1]!;
    const fields = claimCheckFields(
      { claim: claim.claim, context: claim.context_quote ?? "", contextParagraph: claim.context_paragraph ?? "", imageUrls: claim.image_urls ?? [], veryConfidentTrue: false, speculation: false, anchor: { kind: "substack", url: "" } },
      "substack",
    );
    return csvRowToReviewItemInsert(up.id, {
      url: `claim ${check.claim} of ${file.input.title}`,
      text: Object.entries(fields).map(([label, value]) => `${label}: ${value}`).join("\n"),
      bot_id: "simple-bot",
      outcome: check.outcome,
      result: check.outcome_reason ?? (check.note ? "note" : check.outcome),
      note_text: check.note ?? check.noteDraft,
      source_verification: check.verifier.result,
      logs: check.logs,
      failure_reason: check.outcome_reason,
    });
  });
  const { error: itemsError } = await db.from("review_dashboard_items").insert(rows);
  if (itemsError) throw itemsError;
  console.log(`uploaded "${name}" (${rows.length} items, upload ${up.id})`);
}

const dir = join(import.meta.dir, "results-decker", itemId);
const old = JSON.parse(readFileSync(join(dir, "check.old.json"), "utf-8")) as CheckFile;
const fresh = JSON.parse(readFileSync(join(dir, "check.new.json"), "utf-8")) as CheckFile;
if (!old.output.checks[0]?.logs) throw new Error("check.old.json carries no logs; re-run compare.ts --steps check first");
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
await upload(`GOO-159 ${old.input.title} — OLD checks (Sonnet 5 / Gemini) ${stamp}`, old);
await upload(`GOO-159 ${old.input.title} — NEW checks (Muse) ${stamp}`, fresh);

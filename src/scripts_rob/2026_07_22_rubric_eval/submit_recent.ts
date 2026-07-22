/**
 * Rubric eval loop: POST topic notes written since --since to Rob's
 * spreadsheet.page rubric scorer, so post-steering notes accumulate in the
 * shared Google Sheet and the column sums become a before/after chart
 * (PR #303: success = s2_one_claim_only moving from -4 toward positive).
 *
 * Read-only against prod; writes only to the form endpoint + a local ledger
 * (submitted_runs.json, gitignored) so reruns never double-submit a run.
 *
 *   bun run src/scripts_rob/2026_07_22_rubric_eval/submit_recent.ts --since 2026-07-22T22:00:00Z [--dry-run]
 *
 * Grades every WRITTEN note (submitted, candidate, cap-dropped) — steering
 * changes what gets written, and the cap decides separately what submits.
 * Media-bearing tweets get the pipeline's own Gemini media description from
 * pipeline_runs.logs (media.gemini.tweetMedia / quotedTweetMedia); when the
 * tweet has media but no stored description, the tweet field says so rather
 * than leaving graders silently blind.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC = "trump_election_security";
const FORM_URL = "https://spreadsheet.page/api/forms/38823fd56564492db1d2c8dbeaa2bd0e/submit";
const DIR = "src/scripts_rob/2026_07_22_rubric_eval";
const LEDGER = `${DIR}/submitted_runs.json`;

const sinceFlag = process.argv.indexOf("--since");
const since = sinceFlag !== -1 ? process.argv[sinceFlag + 1]! : null;
const dryRun = process.argv.includes("--dry-run");
if (!since || Number.isNaN(Date.parse(since))) {
  console.error("usage: submit_recent.ts --since <ISO timestamp> [--dry-run]");
  process.exit(1);
}

const ledger: string[] = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : [];
const alreadySent = new Set(ledger);
const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// Topic sightings -> processed runs (topic_id lives ONLY on the sightings table).
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string; processed_run_id: string | null }>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, processed_run_id")
    .eq("topic_id", TOPIC)
    .not("processed_run_id", "is", null)
    .gte("processed_at", since),
  "id", "processed sightings");

interface Run { id: string; tweet_id: string; created_at: string; outcome: string | null; outcome_reason: string | null; note_text: string | null; logs: any }
const runs: Run[] = [];
for (const ids of chunk(sightings.map((s) => s.processed_run_id!), 50)) {
  runs.push(...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, created_at, outcome, outcome_reason, note_text, logs").in("id", ids),
    "id"));
}
const written = runs
  .filter((r) => (r.note_text ?? "").trim().length > 0 && !alreadySent.has(r.id))
  .sort((a, b) => a.created_at.localeCompare(b.created_at));
console.log(`[eval] ${sightings.length} processed sightings since ${since}; ${written.length} new written notes to grade`);

const tweetText = new Map<string, { text: string | null; hasMedia: boolean }>();
for (const ids of chunk([...new Set(written.map((r) => r.tweet_id))], 50)) {
  for (const t of await logger.fetchAllRows<{ tweet_id: string; text: string | null; raw_tweet: any }>(
    (c) => c.from("tweets").select("tweet_id, text, raw_tweet").in("tweet_id", ids), "tweet_id")) {
    tweetText.set(t.tweet_id, {
      text: t.text,
      hasMedia: (t.raw_tweet?.includes?.media ?? []).length > 0,
    });
  }
}

function mediaBlock(run: Run, hasMedia: boolean): string {
  const gem = run.logs?.media?.gemini;
  const parts = [gem?.tweetMedia, gem?.quotedTweetMedia].filter((s) => typeof s === "string" && s.trim());
  if (parts.length) return `\n\n[Attached media (pipeline description): ${parts.join(" | ")}]`;
  return hasMedia ? `\n\n[Tweet has attached media; no description available]` : "";
}

let sent = 0;
for (const run of written) {
  const t = tweetText.get(run.tweet_id);
  const tweet = `${(t?.text ?? "(tweet text unavailable)").trim()}${mediaBlock(run, t?.hasMedia ?? false)}`;
  const note = run.note_text!.trim();
  console.log(`\n[${run.created_at.slice(5, 16)}] ${run.tweet_id} ${run.outcome}/${run.outcome_reason ?? ""}`);
  console.log(`  NOTE: ${note.replace(/\s+/g, " ").slice(0, 120)}`);
  if (dryRun) continue;
  const res = await fetch(FORM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: { tweet, note } }),
  });
  if (!res.ok) {
    console.error(`  submit failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const body = (await res.json().catch(() => ({}))) as { rowId?: string };
  console.log(`  -> row ${body.rowId ?? "?"}`);
  ledger.push(run.id);
  sent++;
  await new Promise((r) => setTimeout(r, 1000));
}

if (!dryRun) {
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`\n[eval] submitted ${sent} note(s); ledger now ${ledger.length} run(s)`);
} else {
  console.log(`\n[eval] dry run — nothing submitted`);
}

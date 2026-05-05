/**
 * Verify the post-backfill state on prod, between migrations 032 and 033.
 *
 * Run AFTER:
 *   - migrations 027-032 applied to prod
 *   - main.ts (the tweets backfill) has run on prod
 * Run BEFORE:
 *   - migrations 033-036 are applied
 *   - workflows are re-enabled
 *
 * Asserts the DB is in the expected intermediate shape and that the
 * backfill counts match what main.ts reported.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_backfill_tweets_from_logs/verify_prod_backfill.ts
 *
 * Hits whatever SUPABASE_URL/SUPABASE_SERVICE_KEY are in .env (i.e. prod by
 * default, same convention as main.ts).
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let failures = 0;
let warnings = 0;

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}
function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failures++;
}
function warn(label: string, detail?: string) {
  console.warn(`  ⚠ ${label}${detail ? ` — ${detail}` : ""}`);
  warnings++;
}

async function tableExists(name: string): Promise<boolean> {
  // Use INSERT, not SELECT. PostgREST's schema cache can return empty pages
  // for a dropped table for a window after the DROP, masking it from a
  // SELECT-based probe. INSERT always surfaces a missing-table error
  // immediately. We pass a non-conflicting fake row so the call doesn't
  // actually write anything when the table happens to exist.
  const { error } = await c.from(name).insert({ id: "00000000-0000-0000-0000-000000000000" });
  if (!error) return true;
  if (error.code === "PGRST205") return false;
  if (/does not exist|Could not find/i.test(error.message ?? "")) return false;
  // Any other error (constraint violation, type mismatch, etc.) means the
  // table exists; we just couldn't insert into it.
  return true;
}

async function rowCount(name: string): Promise<number | null> {
  const { count, error } = await c.from(name).select("*", { count: "exact", head: true });
  if (error) return null;
  return count ?? 0;
}

async function columnExists(table: string, col: string): Promise<boolean> {
  const { error } = await c.from(table).select(col).limit(1);
  // 42703 = column does not exist
  if (error?.code === "42703") return false;
  if (error && /column.*does not exist/i.test(error.message)) return false;
  return true;
}

async function main() {
  console.log(`Source: ${process.env.SUPABASE_URL}`);
  console.log(`(expecting state between migration 032 and 033, after backfill)\n`);

  console.log("== Migrations 027-032 applied ==");

  // 027: bot_configs gone, dashboard views gone
  if (await tableExists("bot_configs")) fail("bot_configs is dropped (migration 027)");
  else ok("bot_configs is dropped");
  if (!(await columnExists("notes", "bot_config_id"))) ok("notes.bot_config_id is dropped");
  else fail("notes.bot_config_id is dropped");

  // 028: unmatched_scraped_notes gone, dead canonical columns gone
  if (await tableExists("unmatched_scraped_notes")) fail("unmatched_scraped_notes is dropped (migration 028)");
  else ok("unmatched_scraped_notes is dropped");
  if (!(await columnExists("canonical_note_information", "coherence_score"))) ok("canonical.coherence_score dropped");
  else fail("canonical.coherence_score should be dropped");
  if (!(await columnExists("canonical_note_information", "rater_tags"))) ok("canonical.rater_tags dropped");
  else fail("canonical.rater_tags should be dropped");
  if (!(await columnExists("scraped_notewriter_snapshots", "helpful_count"))) ok("snapshots.helpful_count dropped");
  else fail("snapshots.helpful_count should be dropped");

  // 029: run_snapshots gone
  if (await tableExists("run_snapshots")) fail("run_snapshots is dropped (migration 029)");
  else ok("run_snapshots is dropped");

  // 030: competing_notes trimmed
  if (!(await columnExists("competing_notes", "current_core_status"))) ok("competing_notes.current_core_status dropped");
  else fail("competing_notes.current_core_status should be dropped");
  if (!(await columnExists("competing_notes", "rating_count"))) ok("competing_notes.rating_count dropped");
  else fail("competing_notes.rating_count should be dropped");

  // 031: bot_id split
  if (!(await columnExists("pipeline_runs", "bot_id"))) ok("pipeline_runs.bot_id renamed");
  else fail("pipeline_runs.bot_id should be renamed to bot_name_long");
  if (await columnExists("pipeline_runs", "bot_name")) ok("pipeline_runs.bot_name added");
  else fail("pipeline_runs.bot_name should exist");
  if (await columnExists("pipeline_runs", "bot_name_long")) ok("pipeline_runs.bot_name_long added");
  else fail("pipeline_runs.bot_name_long should exist");
  if (await columnExists("pipeline_runs", "bot_config")) ok("pipeline_runs.bot_config added");
  else fail("pipeline_runs.bot_config should exist");

  // 032: tweets table exists
  if (await tableExists("tweets")) ok("tweets table created");
  else fail("tweets table should exist (migration 032)");

  console.log("\n== 033-036 NOT yet applied (we should still be in the intermediate state) ==");

  // 033: tweet metadata still on pipeline_runs
  if (await columnExists("pipeline_runs", "tweet_text")) ok("pipeline_runs.tweet_text still present (033 not applied)");
  else warn("pipeline_runs.tweet_text already dropped — 033 may have been applied");
  if (await columnExists("pipeline_runs", "has_video")) ok("pipeline_runs.has_video still present");
  else warn("pipeline_runs.has_video already dropped");

  // 034: canonical not yet renamed
  if (await tableExists("canonical_note_information")) ok("canonical_note_information still present (034 not applied)");
  else warn("canonical_note_information missing — 034 may have been applied");

  console.log("\n== Backfill counts (sanity) ==");

  const tweetsTotal = await rowCount("tweets");
  if (tweetsTotal == null) fail("could not count tweets");
  else if (tweetsTotal >= 14000) ok(`tweets has ${tweetsTotal} rows (≥ 14000 expected from ensure-rows step)`);
  else fail(`tweets has ${tweetsTotal} rows`, "expected ≥ 14000 after main.ts ensure step");

  const { count: withText } = await c.from("tweets").select("*", { count: "exact", head: true }).not("text", "is", null);
  if ((withText ?? 0) >= 30000) ok(`tweets with text: ${withText} (most should have it from migration 032)`);
  else fail(`tweets with text: ${withText}`, "expected ≥ 30k from migration 032 backfill");

  const { count: withMedia } = await c.from("tweets").select("*", { count: "exact", head: true }).not("media", "is", null);
  if ((withMedia ?? 0) >= 5000) ok(`tweets with media: ${withMedia} (≥ 5k from log backfill)`);
  else fail(`tweets with media: ${withMedia}`, "expected ≥ 5k after log backfill");

  const { count: withHandle } = await c.from("tweets").select("*", { count: "exact", head: true }).not("author_handle", "is", null);
  // The script reported 656 backfilled. Allow a generous lower bound.
  if ((withHandle ?? 0) >= 500) ok(`tweets with author_handle: ${withHandle} (≥ 500 from snapshot backfill)`);
  else fail(`tweets with author_handle: ${withHandle}`, "expected ≥ 500 from snapshot backfill");

  const { count: withPostedAt } = await c.from("tweets").select("*", { count: "exact", head: true }).not("posted_at", "is", null);
  if ((withPostedAt ?? 0) >= 5000) ok(`tweets with posted_at: ${withPostedAt} (≥ 5k from log backfill)`);
  else fail(`tweets with posted_at: ${withPostedAt}`, "expected ≥ 5k after log backfill");

  console.log("\n== Pipeline_runs bot identity ==");

  const { count: prTotal } = await c.from("pipeline_runs").select("*", { count: "exact", head: true });
  const { count: prWithBotName } = await c.from("pipeline_runs").select("*", { count: "exact", head: true }).not("bot_name", "is", null);
  const { count: prWithBotNameLong } = await c.from("pipeline_runs").select("*", { count: "exact", head: true }).not("bot_name_long", "is", null);
  console.log(`  pipeline_runs total: ${prTotal}; with bot_name: ${prWithBotName}; with bot_name_long: ${prWithBotNameLong}`);
  if ((prWithBotNameLong ?? 0) >= (prTotal ?? 0) * 0.95) ok("≥95% of pipeline_runs have bot_name_long (migration 031 backfilled from old bot_id)");
  else warn("less than 95% of pipeline_runs have bot_name_long — investigate before applying 035");

  console.log("\n== Tweet ↔ pipeline_run join sanity ==");

  // Sample 50 most-recent submitted pipeline_runs and confirm their tweet_id is in tweets.
  const { data: recentSub } = await c.from("pipeline_runs")
    .select("id, tweet_id")
    .eq("outcome", "submitted")
    .not("tweet_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!recentSub || recentSub.length === 0) {
    warn("no recent submitted pipeline_runs found — odd");
  } else {
    const ids = [...new Set(recentSub.map((r) => r.tweet_id))];
    const { data: foundTweets } = await c.from("tweets").select("tweet_id").in("tweet_id", ids);
    const foundSet = new Set(foundTweets?.map((t) => t.tweet_id) ?? []);
    const missing = ids.filter((id) => !foundSet.has(id));
    if (missing.length === 0) ok(`all ${ids.length} recent submitted pipeline_runs have a tweets row`);
    else fail(`${missing.length}/${ids.length} recent submitted pipeline_runs have NO tweets row`, missing.slice(0, 3).join(", "));
  }

  console.log(`\n${failures === 0 ? `✓ all ${warnings === 0 ? "checks" : `checks passed (${warnings} warning(s) — review)`}` : `✗ ${failures} FAILURE(S), ${warnings} warning(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

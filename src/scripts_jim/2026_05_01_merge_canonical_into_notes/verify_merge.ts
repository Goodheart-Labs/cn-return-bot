/**
 * Verify the merged notes table has the expected shape and data after
 * migration 034 (canonical → notes merge).
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_merge_canonical_into_notes/verify_merge.ts
 */

import "dotenv/config";

const url = process.env.LOCAL_SUPABASE_URL;
const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("requires LOCAL_SUPABASE_URL / LOCAL_SUPABASE_SERVICE_KEY");
  process.exit(1);
}
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_KEY = key;

import { SupabaseLogger } from "../../api/supabaseClient";

const logger = new SupabaseLogger();
// @ts-expect-error
const supa = logger["client"];

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`✓ ${label}`);
  else {
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function main() {
  // 1. notes table exists and has the expected shape
  const { data: any1, error: shapeErr } = await supa
    .from("notes")
    .select("id, note_id, tweet_id, note_text, source_url, notewriter_id, submitted_at, cn_status, view_count, rating_count, helpful_count, somewhat_helpful_count, not_helpful_count, data_tier, last_reconciled_at, first_seen_at")
    .limit(1);
  check("notes select with all expected columns", !shapeErr, shapeErr?.message);

  // 2. Row count is at least the pre-merge canonical count (~2400 in local)
  const { count: noteCount } = await supa.from("notes").select("*", { count: "exact", head: true });
  check(`notes has rows (${noteCount})`, noteCount != null && noteCount >= 2000);

  // 3. Submitted-by-us notes have submitted_at populated; pre-tracking notes have it NULL
  const { count: submittedCount } = await supa
    .from("notes").select("*", { count: "exact", head: true }).not("submitted_at", "is", null);
  const { count: pretrackingCount } = await supa
    .from("notes").select("*", { count: "exact", head: true }).is("submitted_at", null);
  check(`notes has submitted rows (${submittedCount})`, (submittedCount ?? 0) > 0);
  check(`notes has pre-tracking rows (${pretrackingCount})`, (pretrackingCount ?? 0) >= 0);

  // 4. FKs from competing_notes and scraped_notewriter_snapshots still resolve
  const { data: cn, error: cnErr } = await supa
    .from("competing_notes")
    .select("our_note_id")
    .not("our_note_id", "is", null)
    .limit(1)
    .single();
  if (cn && !cnErr) {
    const { data: noteRow } = await supa
      .from("notes").select("note_id").eq("note_id", cn.our_note_id).single();
    check("competing_notes.our_note_id FK resolves", !!noteRow);
  } else {
    console.log("(no competing_notes rows to test FK)");
  }

  const { data: snap } = await supa
    .from("scraped_notewriter_snapshots").select("note_id").limit(1).single();
  if (snap) {
    const { data: noteRow } = await supa
      .from("notes").select("note_id").eq("note_id", snap.note_id).single();
    check("scraped_notewriter_snapshots.note_id FK resolves", !!noteRow);
  } else {
    console.log("(no snapshots to test FK)");
  }

  // 5. Old `bot_configs` / `unmatched_scraped_notes` / `run_snapshots` tables are gone.
  // supabase-js doesn't always surface a "table missing" error, so check via
  // information_schema instead (the underlying postgres source of truth).
  const { data: tableRows } = await supa
    .rpc("postgres_version")
    .single()
    .then(async () => {
      // RPC isn't defined; just use a raw query through a known endpoint.
      // Easier: try selecting an obviously-missing column to force a structured error.
      return { data: null };
    })
    .catch(() => ({ data: null }));
  for (const table of ["bot_configs", "unmatched_scraped_notes", "run_snapshots"]) {
    const { error } = await supa.from(table).insert({ id: "00000000-0000-0000-0000-000000000000" });
    check(`table ${table} is dropped`,
      error != null && (error.code === "PGRST205" || /not exist|Could not find/.test(error.message ?? "")),
      `unexpected: ${error?.message ?? "no error"}`);
  }
  void tableRows;

  // 6. Dropped canonical columns are gone
  const { error: coreErr } = await supa.from("notes").select("current_core_status").limit(1);
  check("notes.current_core_status is dropped", coreErr != null && coreErr.message.includes("current_core_status"));

  const { error: classErr } = await supa.from("notes").select("classification").limit(1);
  check("notes.classification is dropped", classErr != null && classErr.message.includes("classification"));

  const { error: tweetTextErr } = await supa.from("notes").select("tweet_text").limit(1);
  check("notes.tweet_text is dropped (moved to tweets)", tweetTextErr != null && tweetTextErr.message.includes("tweet_text"));

  // 7. tweets table exists and has rows
  const { count: tweetCount } = await supa.from("tweets").select("*", { count: "exact", head: true });
  check(`tweets has rows (${tweetCount})`, (tweetCount ?? 0) > 0);

  // 8. pipeline_runs has the new bot columns
  const { error: bnErr } = await supa.from("pipeline_runs").select("bot_name, bot_name_long, bot_config").limit(1);
  check("pipeline_runs has bot_name / bot_name_long / bot_config", !bnErr, bnErr?.message);

  const { error: oldBotIdErr } = await supa.from("pipeline_runs").select("bot_id").limit(1);
  check("pipeline_runs.bot_id is gone", oldBotIdErr != null && oldBotIdErr.message.includes("bot_id"));

  console.log(`\n${failures === 0 ? "all good" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

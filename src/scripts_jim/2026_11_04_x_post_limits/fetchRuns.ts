/* Downloads every X pipeline_runs row since SINCE (without the large columns)
 * and every submitted note, so the daily and hourly tables can be computed
 * offline. Writes runs.json and notes.json next to this file. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAllRows } from "../../everything-core/paging";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-20T00:00:00Z";
const DIR = import.meta.dir;

const runs = await fetchAllRows(
  () => db.from("pipeline_runs")
    .select("id, created_at, outcome, outcome_reason, final_stage, bot_name, cost, note_id, commit_sha, ab_test_picks")
    .gte("created_at", SINCE),
  "id",
  { label: "runs" },
);
writeFileSync(`${DIR}/runs.json`, JSON.stringify(runs));
const notes = await fetchAllRows(
  () => db.from("notes").select("note_id, tweet_id, submitted_at, cn_status").gte("submitted_at", SINCE),
  "note_id",
  { label: "notes" },
);
writeFileSync(`${DIR}/notes.json`, JSON.stringify(notes));
console.log(runs.length, "runs;", notes.length, "notes");

/* Downloads the X note id of every submitted run since 1 Aug and the current
 * Community Notes status of every note submitted since then. Writes
 * submitted.json and noteStatus.json next to this file. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fetchAllRows } from "../../everything-core/paging";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-08-01T00:00:00Z";
const submitted = await fetchAllRows(
  () => db.from("pipeline_runs").select("id, note_id").eq("outcome", "submitted").gte("created_at", SINCE),
  "id",
  { label: "submitted" },
);
const notes = await fetchAllRows(
  () => db.from("notes").select("note_id, cn_status, submitted_at").gte("submitted_at", SINCE),
  "note_id",
  { label: "notes" },
);
writeFileSync(`${import.meta.dir}/submitted.json`, JSON.stringify(submitted));
writeFileSync(`${import.meta.dir}/noteStatus.json`, JSON.stringify(notes));
console.log(submitted.length, "submitted runs;", notes.length, "notes");

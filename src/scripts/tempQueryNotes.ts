import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Get pipeline_runs which has bot_id and join with latest snapshot status
// First get all pipeline runs that resulted in submitted notes
const { data: pipelineData, error: pipelineError } = await supabase
  .from("pipeline_runs")
  .select("note_id, bot_id")
  .eq("outcome", "submitted")
  .not("note_id", "is", null);

if (pipelineError) {
  console.error("Pipeline error:", pipelineError);
  process.exit(1);
}

// Get latest snapshot for each note
const noteIds = pipelineData.map((p) => p.note_id).filter(Boolean);
const { data: snapshots, error: snapshotError } = await supabase
  .from("scraped_notewriter_snapshots")
  .select("note_id, cn_status, scraped_at")
  .in("note_id", noteIds)
  .order("scraped_at", { ascending: false });

if (snapshotError) {
  console.error("Snapshot error:", snapshotError);
  process.exit(1);
}

// Get latest status per note
const latestStatus: Record<string, string> = {};
for (const snap of snapshots) {
  if (!latestStatus[snap.note_id]) {
    latestStatus[snap.note_id] = snap.cn_status || "UNKNOWN";
  }
}

// Map note_id to bot_id
const noteToBotMap: Record<string, string> = {};
for (const p of pipelineData) {
  if (p.note_id) noteToBotMap[p.note_id] = p.bot_id || "unknown";
}

// Group by bot and status
const byBot: Record<string, Record<string, number>> = {};
for (const [noteId, status] of Object.entries(latestStatus)) {
  const bot = noteToBotMap[noteId] || "unknown";
  if (!byBot[bot]) byBot[bot] = {};
  byBot[bot][status] = (byBot[bot][status] || 0) + 1;
}

console.log(JSON.stringify(byBot, null, 2));

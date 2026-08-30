/** A throwaway probe. Some pipeline runs carry no bot_name. This script shows
 *  what that process has been doing, and whether it is still running. */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../api/paging";

const client = getSupabaseClient();
const since = new Date(); since.setUTCDate(since.getUTCDate() - 30);
const sinceIso = since.toISOString();

const runs = await fetchAllRows<{
  id: string; note_id: string | null; tweet_id: string | null; bot_name: string | null;
  outcome: string | null; outcome_reason: string | null; ab_test_picks: Record<string, string> | null; created_at: string;
}>(
  () => client.from("pipeline_runs")
    .select("id, note_id, tweet_id, bot_name, outcome, outcome_reason, ab_test_picks, created_at")
    .is("bot_name", null).gte("created_at", sinceIso).order("created_at", { ascending: false }),
  "id", { label: "probe.runs" },
);

console.log(`\nNull-bot_name pipeline_runs in last 30 days: ${runs.length}\n`);
const byOutcome = new Map<string, number>();
for (const r of runs) byOutcome.set(r.outcome ?? "null", (byOutcome.get(r.outcome ?? "null") ?? 0) + 1);
console.log("Outcomes:", [...byOutcome.entries()].map(([o, n]) => `${o}=${n}`).join("  "));

console.log("\nMost recent 12 runs:");
for (const r of runs.slice(0, 12)) {
  console.log(`  ${r.created_at.slice(0, 16).replace("T", " ")}  ${(r.outcome ?? "-").padEnd(10)} picks=${JSON.stringify(r.ab_test_picks)}  note=${r.note_id ?? "-"}  reason=${r.outcome_reason ?? ""}`);
}

const submittedNoteIds = runs.filter((r) => r.outcome === "submitted" && r.note_id).map((r) => r.note_id!) as string[];
console.log(`\nSubmitted notes from this process: ${submittedNoteIds.length}`);
if (submittedNoteIds.length) {
  const notes = await fetchAllRows<{ note_id: string; tweet_id: string; cn_status: string | null; view_count: number | null; submitted_at: string | null; note_text: string | null }>(
    () => client.from("notes").select("note_id, tweet_id, cn_status, view_count, submitted_at, note_text").in("note_id", submittedNoteIds),
    "note_id", { label: "probe.notes" },
  );
  for (const n of notes) {
    console.log(`  note ${n.note_id} | submitted ${n.submitted_at?.slice(0, 16).replace("T", " ")} | status ${n.cn_status} | ${n.view_count ?? 0} views | tweet ${n.tweet_id}`);
    console.log(`      "${(n.note_text ?? "").slice(0, 120)}..."`);
  }
}
console.log("");

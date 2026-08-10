/** Throwaway: which bots actually ran in the last N days? */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../api/paging";

const client = getSupabaseClient();
const DAYS = Number(process.argv[2]) || 30;
const since = new Date();
since.setUTCDate(since.getUTCDate() - DAYS);
const sinceIso = since.toISOString();

// Notes submitted in window, mapped to bot via submitted pipeline_runs.
const notes = await fetchAllRows<{ note_id: string; cn_status: string | null; submitted_at: string | null }>(
  () => client.from("notes").select("note_id, cn_status, submitted_at").gte("submitted_at", sinceIso),
  "note_id", { label: "act.notes" },
);
const runs = await fetchAllRows<{ id: string; note_id: string | null; bot_name: string | null; outcome: string | null; created_at: string }>(
  () => client.from("pipeline_runs").select("id, note_id, bot_name, outcome, created_at").gte("created_at", sinceIso),
  "id", { label: "act.runs" },
);

const botByNote = new Map<string, string>();
for (const r of runs) if (r.outcome === "submitted" && r.note_id && r.bot_name) botByNote.set(r.note_id, r.bot_name);

const byNoteBot = new Map<string, { total: number; helpful: number; unhelpful: number; needsMore: number; other: number }>();
for (const n of notes) {
  const bot = (n.note_id && botByNote.get(n.note_id)) || "pre-tracking";
  let s = byNoteBot.get(bot); if (!s) { s = { total: 0, helpful: 0, unhelpful: 0, needsMore: 0, other: 0 }; byNoteBot.set(bot, s); }
  s.total++;
  if (n.cn_status === "CURRENTLY_RATED_HELPFUL") s.helpful++;
  else if (n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL") s.unhelpful++;
  else if (n.cn_status === "NEEDS_MORE_RATINGS") s.needsMore++;
  else s.other++;
}

const runsByBot = new Map<string, { runs: number; submitted: number; lastRun: string }>();
for (const r of runs) {
  const bot = r.bot_name || "unknown";
  let s = runsByBot.get(bot); if (!s) { s = { runs: 0, submitted: 0, lastRun: "" }; runsByBot.set(bot, s); }
  s.runs++; if (r.outcome === "submitted") s.submitted++;
  if (r.created_at > s.lastRun) s.lastRun = r.created_at;
}

console.log(`\n=== Last ${DAYS} days (since ${sinceIso.slice(0, 10)}) ===\n`);
console.log("NOTES SUBMITTED, by bot (status of those notes now):");
for (const [bot, s] of [...byNoteBot.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${bot.padEnd(14)} ${String(s.total).padStart(5)} notes  | helpful ${s.helpful}  needs-more ${s.needsMore}  not-helpful ${s.unhelpful}  other ${s.other}`);
}
console.log("\nPIPELINE RUNS, by bot (a bot can run but submit nothing):");
for (const [bot, s] of [...runsByBot.entries()].sort((a, b) => b[1].runs - a[1].runs)) {
  console.log(`  ${bot.padEnd(14)} ${String(s.runs).padStart(6)} runs | ${s.submitted} submitted | last ${s.lastRun.slice(0, 10)}`);
}
console.log("");

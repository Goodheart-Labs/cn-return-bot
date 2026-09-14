import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
async function all(q: (from: number, to: number) => any) { const rows: any[] = []; for (let f = 0; ; f += 1000) { const { data, error } = await q(f, f + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) break; } return rows; }
const runs = await all((f, t) => db.from("pipeline_runs").select("created_at, outcome, outcome_reason").gte("created_at", "2026-09-08T00:00:00Z").range(f, t));
const perDay: Record<string, Record<string, number>> = {};
for (const r of runs) { const d = r.created_at.slice(0, 10); const k = r.outcome === "failed" ? `failed:${r.outcome_reason}` : r.outcome; ((perDay[d] ??= {})[k] ??= 0); perDay[d][k]++; }
console.log("X pipeline_runs per day (UTC) by outcome:");
for (const [d, o] of Object.entries(perDay).sort()) console.log(" ", d, JSON.stringify(o));
const notes = await all((f, t) => db.from("notes").select("submitted_at").gte("submitted_at", "2026-09-08T00:00:00Z").range(f, t));
const nd: Record<string, number> = {}; for (const n of notes) { const d = n.submitted_at.slice(0, 10); nd[d] = (nd[d] ?? 0) + 1; }
console.log("notes submitted per day:", JSON.stringify(nd));
const claims = await all((f, t) => db.from("everything_claims").select("status, status_reason, created_at").gte("created_at", "2026-09-10T00:00:00Z").range(f, t));
const cd: Record<string, Record<string, number>> = {};
for (const c of claims) { const d = c.created_at.slice(0, 10); const k = c.status === "error" ? `error:${String(c.status_reason ?? "").slice(0, 40)}` : c.status; ((cd[d] ??= {})[k] ??= 0); cd[d][k]++; }
console.log("everything_claims per day by status:"); for (const [d, o] of Object.entries(cd).sort()) console.log(" ", d, JSON.stringify(o));

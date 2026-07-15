import { getSupabaseClient } from "../src/api/supabaseClient";
const db = getSupabaseClient();
const SINCE = "2026-07-01T00:00:00Z";

type Row = { outcome_reason: string|null; error_message: string|null; bot_config: any };
const rows: Row[] = [];
let from = 0; const PAGE = 1000;
while (true) {
  const { data, error } = await db.from("pipeline_runs")
    .select("outcome_reason, error_message, bot_config")
    .gte("created_at", SINCE).order("created_at",{ascending:false}).range(from, from+PAGE-1);
  if (error) throw error;
  if (!data || data.length===0) break;
  rows.push(...(data as any));
  if (data.length < PAGE) break; from += PAGE;
}

// Role of a failing stage
function roleOf(stage: string): "search"|"writer"|"verifier"|"correction"|"prefilter"|"base" {
  const s = stage.toLowerCase();
  if (s.includes("search") || s.includes("searxng")) return "search";
  if (s.includes("writer") && s.includes("note")) return "writer";
  if (s.includes("verif") || s.includes("claim")) return "verifier";
  if (s.includes("correction")) return "correction";
  if (s.includes("note_needed") || s.includes("query_writer")) return "prefilter";
  return "base";
}
function modelForRole(role: string, c: any): string {
  if (!c) return "unknown";
  switch(role){
    case "search": return c.search_model ?? c.model ?? "unknown";
    case "writer": return c.writer_model ?? c.model ?? "unknown";
    case "verifier": return c.verifier_model ?? c.model ?? "unknown";
    case "correction": return c.correction_extraction_model ?? c.model ?? "unknown";
    case "prefilter": return "deepseek(prefilter,hardcoded)";
    default: return c.model ?? "unknown";
  }
}

// DENOMINATORS: per role, per model, how many runs invoked it
const den: Record<string, Record<string, number>> = { search:{}, writer:{}, verifier:{}, correction:{}, prefilter:{} };
for (const r of rows) {
  const c = r.bot_config ?? {};
  const add = (role:string, m:string|undefined) => { if(!m) return; den[role][m]=(den[role][m]??0)+1; };
  add("search", c.search_model ?? c.model);
  add("writer", c.writer_model ?? c.model);
  add("verifier", c.verifier_model ?? c.model);
  if (c.correction_extraction) add("correction", c.correction_extraction_model ?? c.model);
  if (c.note_prefilter) add("prefilter", "deepseek(prefilter,hardcoded)");
}

// NUMERATORS: model_output_invalid failures per role+model
const fail: Record<string, Record<string, number>> = { search:{}, writer:{}, verifier:{}, correction:{}, prefilter:{}, base:{} };
for (const r of rows) {
  if (r.outcome_reason !== "model_output_invalid") continue;
  const stage = (r.error_message ?? "").split(":")[0].trim();
  const role = roleOf(stage);
  const m = modelForRole(role, r.bot_config);
  fail[role][m] = (fail[role][m]??0)+1;
}

console.log(`Window: since ${SINCE} | total runs = ${rows.length}\n`);
for (const role of ["search","writer","verifier","correction","prefilter"]) {
  console.log(`### ${role.toUpperCase()} stage`);
  const models = new Set([...Object.keys(den[role]??{}), ...Object.keys(fail[role]??{})]);
  const sorted = [...models].sort((a,b)=>(den[role][b]??0)-(den[role][a]??0));
  for (const m of sorted) {
    const d = den[role][m] ?? 0; const f = fail[role][m] ?? 0;
    console.log(`  ${m.padEnd(38)} ${String(f).padStart(4)} fail / ${String(d).padStart(5)} runs = ${d? (100*f/d).toFixed(2):"n/a"}%`);
  }
  console.log("");
}
process.exit(0);

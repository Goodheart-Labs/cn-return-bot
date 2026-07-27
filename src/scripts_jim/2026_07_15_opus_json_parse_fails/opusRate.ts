import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();
const SINCE = "2026-07-01T00:00:00Z";

// page through all runs since SINCE
type Row = { outcome_reason: string|null; error_message: string|null; bot_config: any };
const rows: Row[] = [];
let from = 0; const PAGE = 1000;
while (true) {
  const { data, error } = await db.from("pipeline_runs")
    .select("outcome_reason, error_message, bot_config")
    .gte("created_at", SINCE)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  rows.push(...(data as any));
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log("total runs since", SINCE, "=", rows.length);

// distinct stage prefixes among model_output_invalid
const stageCounts: Record<string, number> = {};
for (const r of rows) {
  if (r.outcome_reason !== "model_output_invalid") continue;
  const stage = (r.error_message ?? "").split(":")[0].trim();
  stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
}
console.log("\n=== model_output_invalid by stage prefix ===");
console.log(stageCounts);

// resolve which model a stage used, from bot_config
function isOpus(m: string|undefined): boolean { return !!m && m.includes("opus"); }
function stageModel(stage: string, cfg: any): string|undefined {
  if (!cfg) return undefined;
  const s = stage.toLowerCase();
  if (s.includes("search")) return cfg.search_model ?? cfg.model;
  if (s.includes("writer") && s.includes("note")) return cfg.writer_model ?? cfg.model;
  if (s === "note_writer" || s.includes("notewriter")) return cfg.writer_model ?? cfg.model;
  if (s.includes("verif") || s.includes("claim")) return cfg.verifier_model ?? cfg.model;
  if (s.includes("correction")) return cfg.correction_extraction_model ?? cfg.model;
  if (s.includes("query_writer") || s.includes("note_needed")) return "DEEPSEEK(prefilter,hardcoded)";
  return cfg.model; // base
}

// failures attributed to opus, grouped by stage
const opusFailByStage: Record<string, number> = {};
const failByResolvedModel: Record<string, number> = {};
for (const r of rows) {
  if (r.outcome_reason !== "model_output_invalid") continue;
  const stage = (r.error_message ?? "").split(":")[0].trim();
  const m = stageModel(stage, r.bot_config) ?? "unknown";
  failByResolvedModel[m] = (failByResolvedModel[m] ?? 0) + 1;
  if (isOpus(m)) opusFailByStage[stage] = (opusFailByStage[stage] ?? 0) + 1;
}
console.log("\n=== model_output_invalid failures by RESOLVED model of failing stage ===");
console.log(failByResolvedModel);
console.log("\n=== opus failures by stage ===");
console.log(opusFailByStage);

// denominators: how many runs used opus in each stage field
const den = { writer:0, search:0, verifier:0, correction:0, base:0, anyOpus:0 };
for (const r of rows) {
  const c = r.bot_config ?? {};
  const w = isOpus(c.writer_model ?? c.model);
  const se = isOpus(c.search_model ?? c.model);
  const v = isOpus(c.verifier_model ?? c.model);
  const co = isOpus(c.correction_extraction_model ?? c.model);
  const b = isOpus(c.model);
  if (w) den.writer++; if (se) den.search++; if (v) den.verifier++; if (co) den.correction++; if (b) den.base++;
  if (w||se||v||co||b) den.anyOpus++;
}
console.log("\n=== runs using OPUS per stage (denominators) ===");
console.log(den);

const totalOpusFail = Object.values(opusFailByStage).reduce((a,b)=>a+b,0);
console.log(`\n=== ANSWER ===`);
console.log(`Opus writer:   ${opusFailByStage["note_writer"]??opusFailByStage["noteWriter"]??0} fails / ${den.writer} opus-writer runs`);
console.log(`Runs with ANY opus stage: ${den.anyOpus}; opus-attributed model_output_invalid: ${totalOpusFail} => ${den.anyOpus? (100*totalOpusFail/den.anyOpus).toFixed(2):"n/a"}%`);
process.exit(0);

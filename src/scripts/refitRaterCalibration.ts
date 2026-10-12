/**
 * Refits the note rater's probability adjustment on matured notes and stores
 * it in pipeline_state (key rater_calibration). Run weekly by
 * .github/workflows/rater-calibration.yml. See pipeline/score/raterCalibration.ts.
 *
 * For each outcome (helpful, not helpful) it fits P = sigmoid(a + b * logit(raw))
 * on every note rated by the rater whose outcome is at least 14 days old, with
 * recent notes weighted more (60-day half-life). It refuses to store a fit
 * from fewer than 300 such notes, or one with a non-positive slope.
 */

import { createClient } from "@supabase/supabase-js";
import { CALIBRATION_STATE_KEY, logit, type Calibration, type Curve } from "../pipeline/score/raterCalibration";
import { NOTE_RATER_SCORE_TYPE } from "../pipeline/prompts/noteRater";

const MATURITY_DAYS = 14;
const WINDOW_DAYS = 120;
const HALF_LIFE_DAYS = 60;
const MIN_NOTES = 300;

/** Weighted logistic regression with one input, by Newton's method. */
export function fitCurve(x: number[], y: number[], w: number[]): Curve {
  let a = Math.log(0.1 / 0.9), b = 1;
  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * x[i]!)));
      const r = w[i]! * (y[i]! - p), q = w[i]! * p * (1 - p);
      g0 += r; g1 += r * x[i]!; h00 += q; h01 += q * x[i]!; h11 += q * x[i]! * x[i]!;
    }
    const det = h00 * h11 - h01 * h01;
    if (det <= 0) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }
  return { a, b };
}

async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const matureBefore = new Date(now - MATURITY_DAYS * 86_400_000).toISOString();

  const rows: { run: string; pH: number; pNH: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("pipeline_scores").select("pipeline_run_id, score_metadata")
      .eq("score_type", NOTE_RATER_SCORE_TYPE).gte("created_at", since).order("created_at").order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const m = (r.score_metadata ?? {}) as Record<string, unknown>;
      if (typeof m.p_helpful === "number" && typeof m.p_not_helpful === "number") rows.push({ run: r.pipeline_run_id as string, pH: m.p_helpful, pNH: m.p_not_helpful });
    }
    if (!data || data.length < 1000) break;
  }
  const noteByRun = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await client.from("pipeline_runs").select("id, note_id").in("id", rows.slice(i, i + 500).map((r) => r.run)).not("note_id", "is", null);
    if (error) throw error;
    for (const r of data ?? []) noteByRun.set(r.id as string, r.note_id as string);
  }
  const outcome = new Map<string, { h: number; nh: number; at: number }>();
  const noteIds = [...new Set(noteByRun.values())];
  for (let i = 0; i < noteIds.length; i += 500) {
    const { data, error } = await client.from("notes").select("note_id, cn_status, submitted_at").in("note_id", noteIds.slice(i, i + 500)).lt("submitted_at", matureBefore);
    if (error) throw error;
    for (const n of data ?? []) outcome.set(n.note_id as string, { h: n.cn_status === "CURRENTLY_RATED_HELPFUL" ? 1 : 0, nh: n.cn_status === "CURRENTLY_RATED_NOT_HELPFUL" ? 1 : 0, at: Date.parse(n.submitted_at as string) });
  }
  const xH: number[] = [], xNH: number[] = [], yH: number[] = [], yNH: number[] = [], w: number[] = [];
  for (const r of rows) {
    const o = outcome.get(noteByRun.get(r.run) ?? ""); if (!o) continue;
    xH.push(logit(r.pH)); xNH.push(logit(r.pNH)); yH.push(o.h); yNH.push(o.nh);
    w.push(Math.pow(0.5, (now - o.at) / 86_400_000 / HALF_LIFE_DAYS));
  }
  console.log(`${rows.length} rated notes in the last ${WINDOW_DAYS} days; ${w.length} with an outcome at least ${MATURITY_DAYS} days old`);
  if (w.length < MIN_NOTES) { console.log(`fewer than ${MIN_NOTES}: keeping the current calibration`); return; }
  const helpful = fitCurve(xH, yH, w), notHelpful = fitCurve(xNH, yNH, w);
  if (!(helpful.b > 0) || !(notHelpful.b > 0)) { console.log(`a non-positive slope (${helpful.b}, ${notHelpful.b}): keeping the current calibration`); return; }
  const cal: Calibration = { helpful, notHelpful, fittedAt: new Date(now).toISOString().slice(0, 10), notes: w.length };
  console.log("fit:", JSON.stringify(cal));
  const { error } = await client.from("pipeline_state").upsert({ key: CALIBRATION_STATE_KEY, value: JSON.stringify(cal), updated_at: new Date(now).toISOString() });
  if (error) throw error;
  console.log("stored");
}

if (import.meta.main) main().catch((err) => { console.error(err); process.exit(1); });

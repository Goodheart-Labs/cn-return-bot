/**
 * Cached satire-detector overlay.
 *
 * Measures the MARGINAL effect of adding cheap-bot's pre-search satire detector
 * to an already-completed run, with maximum caching: we run ONLY the satire
 * detector (1 LLM call/row) and reuse the baseline run's category for every row
 * the detector doesn't fire on. No search / writer / judge / verifier / eval-
 * judge calls.
 *
 * The detector is a pre-search gate, so for any row where it doesn't fire the
 * downstream result is byte-identical to the baseline. For a row where it fires,
 * the pipeline would have early-exited with no_correction (declined):
 *   - GT = no note needed  → a correct decline  (FP removed → WIN)
 *   - GT = note needed      → a missed note      (COST)
 * Rows that already declined/missed for other reasons stay declines/misses; the
 * gate only changes WHERE the decline happened, not PASS/FP — but we still run
 * the detector on them as a precision check (it must not fire on real claims).
 *
 * The detector's input is the post context (post + media + comments + profile),
 * which the baseline run already logged verbatim inside the note-needed judge's
 * userMessage. We slice off the note/findings and feed only the post block.
 *
 * Usage: bun run src/scripts_jim/2026_05_29_satire_overlay/overlay.ts [baselineCsv]
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords, escapeCsvField } from "../../utils/csv";
import { runSatireDetector } from "../../pipeline/cheap-bot/satireDetector";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withForcedPicks, runABTests } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { autoOpenInDashboard } from "../../local/dashboardAutoOpen";
import { captureProdSupabaseCreds } from "../../local/prodSupabaseCreds";

const DEFAULT_CSV = "dataset_runs/rejudge-iter07-valset-refresh/results_rejudge-iter07-valset-refresh.csv";
const CONCURRENCY = 8;

interface Row { [k: string]: string; }

function loadCsv(csvPath: string): { headers: string[]; rows: Row[] } {
  const records = parseCsvRecords(fs.readFileSync(csvPath, "utf8").trim());
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((fields) => {
    const row: Row = {};
    headers.forEach((h, i) => (row[h] = fields[i] ?? ""));
    return row;
  });
  return { headers, rows };
}

function writeCsv(outPath: string, headers: string[], rows: Row[]): void {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) lines.push(headers.map((h) => escapeCsvField(row[h] ?? "")).join(","));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

/** The note-needed judge's userMessage is "## Original post\n...\n## Research
 *  findings\n...\n## Proposed community note\n...". The satire detector wants
 *  only the post block (post + media + comments + profile), so cut at the first
 *  findings/note marker. Returns null when no judge log exists (search-exhausted
 *  rows that produced no note — the gate can't change their outcome). */
function extractPostContext(row: Row): string | null {
  let logs: any;
  try { logs = JSON.parse(row.logs ?? ""); } catch { return null; }
  const m0 = logs?.simpleBot?.judge?.messages?.["0"] ?? logs?.simpleBot?.judge?.messages?.[0];
  const um: string = m0?.userMessage ?? "";
  if (!um) return null;
  const cuts = ["\n## Research findings", "\n## Proposed community note"]
    .map((m) => um.indexOf(m))
    .filter((i) => i >= 0);
  return cuts.length ? um.slice(0, Math.min(...cuts)).trim() : um.trim();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Baseline categories where a note was PUBLISHED — the only rows whose PASS/FP
// outcome changes if the satire gate fires.
const PUBLISHED_GT_NO = new Set(["nnw_fp_published", "nnw_fp_harmless", "nnw_eval_disagrees"]);
const PUBLISHED_GT_YES = new Set(["nw_success", "nw_published_directional", "nw_published_bad"]);

interface Decision {
  url: string;
  needs_note: string;
  baseline: string;
  fired: boolean;
  reasoning: string;
  effect: "fp_removed" | "real_note_lost" | "bad_note_declined" | "earlier_decline_no_change" | "no_postcontext" | "not_satire" | "detector_error";
}

async function main() {
  captureProdSupabaseCreds();
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) { console.error(`not found: ${csvPath}`); process.exit(1); }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const runName = process.argv[3] ?? `satire-overlay-${stamp}`;

  const { config } = withForcedPicks({ bot: "cheap-bot" }, () => runABTests(AB_TESTS));
  console.log(`[overlay] satire model=${config.note_judge_model ?? config.model} temp=${config.temperature} reasoning=${config.reasoning_effort} satire_detector=${config.satire_detector}`);

  const { headers, rows } = loadCsv(csvPath);
  if (!headers.includes("result")) headers.push("result");
  console.log(`[overlay] loaded ${rows.length} rows from ${csvPath}\n`);

  let done = 0;
  const decisions: Decision[] = await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    const baseline = row.result ?? "";
    const gt = (row.needs_note ?? "").trim().toLowerCase();
    const postContext = extractPostContext(row);

    const base: Omit<Decision, "fired" | "reasoning" | "effect"> = { url: row.url ?? "", needs_note: gt, baseline };

    if (!postContext) {
      done++;
      return { ...base, fired: false, reasoning: "", effect: "no_postcontext" };
    }

    let satire: { isSatire: boolean; reasoning: string };
    try {
      satire = await withBotConfig(config as BotConfig, () => runSatireDetector(postContext));
    } catch (err: any) {
      // Fail open: a detector glitch must never suppress a note. Treat as not-fired.
      done++;
      return { ...base, fired: false, reasoning: `detector_error: ${err?.message?.slice(0, 120) ?? "unknown"}`, effect: "detector_error" };
    }
    done++;
    if (done % 10 === 0 || done === rows.length) console.log(`[overlay] ${done}/${rows.length}`);

    if (!satire.isSatire) return { ...base, fired: false, reasoning: satire.reasoning, effect: "not_satire" };

    // Fired → the stage-0 gate pre-empts every later stage, so the row's
    // category becomes a satire decline regardless of what it was before.
    row.result = gt === "yes" ? "nw_miss_satire_killed" : "nnw_correct_satire_rejected";

    // Effect on PASS/FP (for the report).
    let effect: Decision["effect"];
    if (PUBLISHED_GT_NO.has(baseline)) effect = "fp_removed";
    else if (baseline === "nw_success" || baseline === "nw_published_directional") effect = "real_note_lost";
    else if (baseline === "nw_published_bad") effect = "bad_note_declined";
    else effect = "earlier_decline_no_change"; // already a decline/miss baseline
    return { ...base, fired: true, reasoning: satire.reasoning, effect };
  });

  report(rows, decisions, csvPath);

  // Write the satire-applied run and open it in the dashboard.
  const outDir = path.join(process.cwd(), "dataset_runs", runName);
  fs.mkdirSync(outDir, { recursive: true });
  const outCsv = path.join(outDir, `results_${runName}.csv`);
  writeCsv(outCsv, headers, rows);
  await autoOpenInDashboard(outCsv, runName);
  console.log(`\n[overlay] satire-applied run → ${outCsv}`);
}

function fmtRate(n: number, total: number): string {
  if (total === 0) return "0 (0%)";
  return `${n} (${((n / total) * 100).toFixed(0)}%)`;
}

function report(rows: Row[], decisions: Decision[], csvPath: string) {
  const fired = decisions.filter((d) => d.fired);
  const byEffect = (e: Decision["effect"]) => fired.filter((d) => d.effect === e);

  // Apply the overlay to baseline counts: move fired PUBLISHED rows to a decline.
  const counts: Record<string, number> = {};
  for (const d of decisions) counts[d.baseline] = (counts[d.baseline] ?? 0) + 1;
  const overlay = { ...counts };
  const move = (from: string, to: string) => { overlay[from] = (overlay[from] ?? 0) - 1; overlay[to] = (overlay[to] ?? 0) + 1; };
  for (const d of fired) {
    if (d.effect === "fp_removed") move(d.baseline, "nnw_correct_writer_abstained");
    else if (d.effect === "real_note_lost" || d.effect === "bad_note_declined") move(d.baseline, "nw_miss_writer_abstained");
    // earlier_decline_no_change: PASS/FP identical, leave in baseline bucket
  }

  const sum = (c: Record<string, number>, keys: string[]) => keys.reduce((a, k) => a + (c[k] ?? 0), 0);
  const NW_OK = ["nw_success", "nw_published_directional"];
  const NW_ALL = ["nw_success", "nw_published_directional", "nw_published_bad", "nw_miss_judge_killed_good", "nw_miss_judge_killed_bad", "nw_miss_verifier_killed_good", "nw_miss_verifier_killed_bad", "nw_miss_writer_abstained", "nw_miss_search_exhausted"];
  const NNW_CORRECT = ["nnw_correct_writer_abstained", "nnw_correct_judge_rejected", "nnw_correct_verifier_rejected", "nnw_correct_search_exhausted"];
  const NNW_ALL = [...NNW_CORRECT, "nnw_fp_harmless", "nnw_fp_published", "nnw_eval_disagrees"];

  const metrics = (c: Record<string, number>) => {
    const nwTotal = sum(c, NW_ALL), nnwTotal = sum(c, NNW_ALL);
    const pass = sum(c, NW_OK) + sum(c, NNW_CORRECT);
    return {
      pass, scored: nwTotal + nnwTotal,
      hardFp: c["nnw_fp_published"] ?? 0, nnwTotal,
      pubNotNeeded: (c["nnw_fp_harmless"] ?? 0) + (c["nnw_fp_published"] ?? 0),
    };
  };
  const b = metrics(counts), o = metrics(overlay);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`SATIRE OVERLAY on ${path.basename(csvPath)}`);
  console.log(`${"=".repeat(64)}`);
  const errored = decisions.filter((d) => d.effect === "detector_error").length;
  console.log(`\nDetector fired on ${fired.length} of ${decisions.filter((d) => d.effect !== "no_postcontext").length} rows with post context`);
  console.log(`  (${decisions.filter((d) => d.effect === "no_postcontext").length} search-exhausted rows skipped — no note to suppress; ${errored} detector errors → failed open, not fired)\n`);

  console.log(`FIRED breakdown:`);
  console.log(`  ✅ FP removed (GT=no, was published):        ${byEffect("fp_removed").length}`);
  console.log(`  ⚠️  REAL note lost (GT=yes, good/directional): ${byEffect("real_note_lost").length}   <-- the cost`);
  console.log(`  ◽ bad note declined (GT=yes, was bad):       ${byEffect("bad_note_declined").length}`);
  console.log(`  ◽ earlier decline, no PASS/FP change:        ${byEffect("earlier_decline_no_change").length}`);

  console.log(`\nMETRICS  (baseline → overlay):`);
  console.log(`  PASS:                      ${fmtRate(b.pass, b.scored)}  →  ${fmtRate(o.pass, o.scored)}`);
  console.log(`  HARD FP RATE:              ${fmtRate(b.hardFp, b.nnwTotal)}  →  ${fmtRate(o.hardFp, o.nnwTotal)}`);
  console.log(`  PUBLISHED-WHEN-NOT-NEEDED: ${fmtRate(b.pubNotNeeded, b.nnwTotal)}  →  ${fmtRate(o.pubNotNeeded, o.nnwTotal)}`);

  if (byEffect("real_note_lost").length || byEffect("bad_note_declined").length) {
    console.log(`\n⚠️  GT=yes rows the detector wrongly flagged as satire (real notes suppressed):`);
    for (const d of [...byEffect("real_note_lost"), ...byEffect("bad_note_declined")]) {
      console.log(`  ${d.url}\n     [${d.baseline}] ${d.reasoning}`);
    }
  }
  console.log(`\n✅ FP rows correctly declined as satire:`);
  for (const d of byEffect("fp_removed")) console.log(`  ${d.url}\n     [${d.baseline}] ${d.reasoning}`);

  if (byEffect("earlier_decline_no_change").length) {
    console.log(`\n◽ fired on already-declined/missed rows (cheaper, no metric change) — verify these are genuinely satire:`);
    for (const d of byEffect("earlier_decline_no_change")) console.log(`  [${d.baseline}] ${d.url}\n     ${d.reasoning}`);
  }

  const outDir = path.dirname(new URL(import.meta.url).pathname);
  const outPath = path.join(outDir, "decisions.csv");
  const headers = ["url", "needs_note", "baseline", "fired", "effect", "reasoning"];
  const lines = [headers.join(",")];
  for (const d of decisions) lines.push(headers.map((h) => escapeCsvField(String((d as any)[h] ?? ""))).join(","));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`\n[overlay] per-row decisions → ${outPath}`);
  console.log("=".repeat(64));
}

main().catch((e) => { console.error("[overlay] fatal:", e); process.exit(1); });

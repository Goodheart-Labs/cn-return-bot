/**
 * Judge stability probe — how much of the val signal is judge sampling noise?
 *
 * Runs the SAME judge prompt K times on each writer_done row (reusing the row
 * inputs already captured in judge_replay_results.json) and reports, per row,
 * how many of the K runs said note_needed=true. A row that lands 0/K or K/K is
 * stable; anything in between is a coin-flip the hill-climb can't measure
 * through. We then bound FP/recall by best-case and worst-case sampling.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_28_judge_iter7_replay/stabilityProbe.ts [K]
 */
import "dotenv/config";
import * as fs from "fs";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { runNoteNeededJudge } from "../../pipeline/simple-bot/judge";

const K = Number(process.argv[2] ?? 5);
// argv[3] overrides reasoning_effort ("off" → omit) to isolate the noise source.
const REASONING = process.argv[3];
const CONCURRENCY = 8;
const RESULTS = "src/scripts_jim/2026_05_28_judge_iter7_replay/judge_replay_results.json";

const CONFIG: BotConfig = {
  botId: "cheap-bot",
  model: "deepseek/deepseek-v4-flash",
  note_needed_judge: true,
  note_judge_model: "deepseek/deepseek-v4-flash",
  reasoning_effort: "high",
  temperature: 0, // mirror the cheap_bot_temperature A/B test — re-probe the de-noised judge
  ...(REASONING ? { reasoning_effort: REASONING === "off" ? undefined : (REASONING as any) } : {}),
  web_search: "searxng",
  video_description_strategy: "frames",
  scoreFilters: [],
  parallel_research: false,
  feed_size: "small",
};

interface Row {
  tweetId: string;
  bucket: string;
  needsNote: boolean;
  userMessage: string;
  noteText: string;
  sources: string[];
}

const rows: Row[] = JSON.parse(fs.readFileSync(RESULTS, "utf8")).map((r: any) => ({
  tweetId: r.tweetId,
  bucket: r.bucket,
  needsNote: r.needsNote,
  userMessage: r.userMessage,
  noteText: r.noteText,
  sources: r.sources ?? [],
}));

async function runPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Flatten to K judge tasks per row, then regroup.
const tasks = rows.flatMap((row) => Array.from({ length: K }, () => row));
const verdicts = await runPool(tasks, CONCURRENCY, async (row) => {
  try {
    const j = await withBotConfig(CONFIG, () =>
      runNoteNeededJudge({ postContext: row.userMessage, noteText: row.noteText, sources: row.sources }),
    );
    return { tweetId: row.tweetId, yes: j.noteNeeded, ok: true };
  } catch {
    return { tweetId: row.tweetId, yes: false, ok: false }; // unparseable output → its own noise signal
  }
});

const yesCount = new Map<string, number>();
const okCount = new Map<string, number>();
let errors = 0;
for (const v of verdicts) {
  if (!v.ok) errors++;
  okCount.set(v.tweetId, (okCount.get(v.tweetId) ?? 0) + (v.ok ? 1 : 0));
  yesCount.set(v.tweetId, (yesCount.get(v.tweetId) ?? 0) + (v.yes ? 1 : 0));
}

const noRows = rows.filter((r) => !r.needsNote);
const yesRows = rows.filter((r) => r.needsNote);

const isUnstable = (r: Row) => {
  const c = yesCount.get(r.tweetId) ?? 0;
  return c !== 0 && c !== K;
};
const unstableNo = noRows.filter(isUnstable).length;
const unstableYes = yesRows.filter(isUnstable).length;

// FP/recall bands: worst-case = any run that ever said yes counts; best-case = majority.
const everYes = (r: Row) => (yesCount.get(r.tweetId) ?? 0) > 0;
const majYes = (r: Row) => (yesCount.get(r.tweetId) ?? 0) * 2 > K;
const neverNo = (r: Row) => (yesCount.get(r.tweetId) ?? 0) === K;

console.log(`K=${K} runs/row over ${rows.length} writer_done rows (NO=${noRows.length}, YES=${yesRows.length})`);
console.log(`unparseable judge outputs: ${errors}/${rows.length * K} calls\n`);
console.log(`UNSTABLE rows (flip across the ${K} runs): NO-side=${unstableNo}/${noRows.length}   YES-side=${unstableYes}/${yesRows.length}`);
console.log(`  → ${unstableNo + unstableYes}/${rows.length} of the eval is a coin-flip at this model+effort\n`);

console.log("FP (needs_note=NO, judge publishes) — lower better:");
console.log(`  worst-case (ever-yes)=${noRows.filter(everYes).length}   majority=${noRows.filter(majYes).length}   unanimous-yes=${noRows.filter(neverNo).length}`);
console.log("Recall (needs_note=YES, judge keeps) — higher better:");
console.log(`  best-case (ever-yes)=${yesRows.filter(everYes).length}   majority=${yesRows.filter(majYes).length}   unanimous-yes=${yesRows.filter(neverNo).length}`);

// List the unstable rows so we can see which decisions can't be trusted.
const fmt = (r: Row) => `  [${r.bucket}] ${r.tweetId}  yes=${yesCount.get(r.tweetId)}/${K}`;
console.log(`\n--- unstable NO rows (FP that flips) ---`);
for (const r of noRows.filter(isUnstable)) console.log(fmt(r));
console.log(`\n--- unstable YES rows (recall that flips) ---`);
for (const r of yesRows.filter(isUnstable)) console.log(fmt(r));

fs.writeFileSync(
  "src/scripts_jim/2026_05_28_judge_iter7_replay/stability_counts.json",
  JSON.stringify(Object.fromEntries([...yesCount.entries()].map(([k, v]) => [k, { yes: v, of: K }])), null, 2),
);

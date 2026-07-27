/**
 * Judge-only re-eval (iter-07 G1-G3 judge vs iter-06).
 *
 * iter-06 ran live SearXNG and never populated a search cache for its queries,
 * so the verifier's snippet fallback can't be faithfully reconstructed. But the
 * judge never uses snippets (or findings) — it sees only {postContext, noteText,
 * sources}. Since the judge prompt is the ONLY thing that changed, replaying just
 * the judge on iter-06's logged writer notes is the faithful, cheap measurement:
 * no verifier, no snippets, no SearXNG — ~86 judge calls.
 *
 * For each writer_done row we compare the new note_needed decision to iter-06's,
 * grouped by ground-truth needs_note, and surface the published-FP rows (the 18
 * the G1-G3 rewrite targets).
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_28_judge_iter7_replay/replayJudgeOnly.ts \
 *     dataset_runs/tryout-iter-06-cheap-bot-2026-05-28-1918
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { runNoteNeededJudge } from "../../pipeline/simple-bot/judge";

const runDir = process.argv[2] ?? "dataset_runs/tryout-iter-06-cheap-bot-2026-05-28-1918";
const CONCURRENCY = 8;

// Mirror iter-06's cheap-bot config (from its logged bot.config).
const CONFIG: BotConfig = {
  botId: "cheap-bot",
  model: "deepseek/deepseek-v4-flash",
  note_needed_judge: true,
  note_judge_model: "deepseek/deepseek-v4-flash",
  reasoning_effort: "high",
  temperature: 0, // mirror the cheap_bot_temperature A/B test
  web_search: "searxng",
  video_description_strategy: "frames",
  scoreFilters: [],
  parallel_research: false,
};

interface Row {
  tweetId: string;
  bucket: string;
  needsNote: boolean;
  userMessage: string;
  noteText: string;
  sources: string[];
  iter06NoteNeeded: boolean | undefined;
}

function loadWriterDoneRows(): Row[] {
  const rows: Row[] = [];
  for (const file of fs.readdirSync(runDir).filter((f) => f.endsWith(".json"))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(runDir, file), "utf8"));
    if (!Array.isArray(parsed)) continue;
    for (const r of parsed) {
      const logs = r.logs ?? {};
      const userMessage: string = logs?.cheapBot?.queryWriter?.messages?.["0"]?.userMessage ?? "";
      const response = logs?.simpleBot?.writer?.attempts?.["0"]?.response ?? {};
      const noteText: string = response.note_text ?? "";
      const queries: string[] = logs?.cheapBot?.queries ?? [];
      if (!(queries.length > 0 && noteText.trim())) continue; // writer_done only
      rows.push({
        tweetId: logs?.tweet?.post?.id ?? "?",
        bucket: file.replace(/\.json$/, ""),
        needsNote: String(r.needs_note).toLowerCase() === "yes",
        userMessage,
        noteText,
        sources: response.sources ?? [],
        iter06NoteNeeded: logs?.simpleBot?.judge?.messages?.["1"]?.content?.note_needed,
      });
    }
  }
  return rows;
}

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

const rows = loadWriterDoneRows();
console.log(`writer_done rows: ${rows.length} (needs_note=yes: ${rows.filter((r) => r.needsNote).length}, no: ${rows.filter((r) => !r.needsNote).length})\n`);

const results = await runPool(rows, CONCURRENCY, async (row) => {
  const judge = await withBotConfig(CONFIG, () =>
    runNoteNeededJudge({ postContext: row.userMessage, noteText: row.noteText, sources: row.sources }),
  );
  return { ...row, newNoteNeeded: judge.noteNeeded, reasoning: judge.reasoning };
});

// --- Tabulate ---
const noRows = results.filter((r) => !r.needsNote); // ground truth: should NOT get a note
const yesRows = results.filter((r) => r.needsNote); // ground truth: should get a note

const fpBefore = noRows.filter((r) => r.iter06NoteNeeded === true).length;
const fpAfter = noRows.filter((r) => r.newNoteNeeded === true).length;
const recallBefore = yesRows.filter((r) => r.iter06NoteNeeded === true).length;
const recallAfter = yesRows.filter((r) => r.newNoteNeeded === true).length;

console.log("=== JUDGE DECISIONS (note_needed=true means judge would publish) ===");
console.log(`needs_note=NO  rows (${noRows.length}): judge said YES  iter06=${fpBefore}  →  iter07=${fpAfter}   [lower is better — these are FP candidates]`);
console.log(`needs_note=YES rows (${yesRows.length}): judge said YES  iter06=${recallBefore}  →  iter07=${recallAfter}   [higher is better — recall]\n`);

const newlyKilledFP = noRows.filter((r) => r.iter06NoteNeeded === true && r.newNoteNeeded === false);
const stillApprovedFP = noRows.filter((r) => r.newNoteNeeded === true);
const newlyKilledGood = yesRows.filter((r) => r.iter06NoteNeeded === true && r.newNoteNeeded === false);

console.log(`=== FP rows the new judge now KILLS (${newlyKilledFP.length}) — these are FP reductions ===`);
for (const r of newlyKilledFP) console.log(`  [${r.bucket}] ${r.tweetId}\n     ${r.reasoning}`);

console.log(`\n=== needs_note=NO rows the new judge STILL approves (${stillApprovedFP.length}) — remaining FP risk ===`);
for (const r of stillApprovedFP) console.log(`  [${r.bucket}] ${r.tweetId}\n     ${r.reasoning}`);

console.log(`\n=== RECALL COST: needs_note=YES rows the new judge now KILLS (${newlyKilledGood.length}) ===`);
for (const r of newlyKilledGood) console.log(`  [${r.bucket}] ${r.tweetId}\n     ${r.reasoning}`);

// Persist full per-row results for inspection.
const outPath = path.join("src/scripts_jim/2026_05_28_judge_iter7_replay", "judge_replay_results.json");
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nfull results → ${outPath}`);

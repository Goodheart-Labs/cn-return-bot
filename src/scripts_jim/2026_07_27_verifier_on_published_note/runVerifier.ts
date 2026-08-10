/**
 * Re-run ONLY the source verifier on a note that is already in the DB.
 *
 * Pulls the published note (text + sources) and its prod pipeline_runs row for
 * the post context / search findings the verifier reads as background, then
 * calls verifySources with that run's exact bot config. Nothing else runs — no
 * search, no writer, no judge.
 *
 *   bun run src/scripts_jim/2026_07_27_verifier_on_published_note/runVerifier.ts <tweet-id>
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { verifySources } from "../../pipeline/verify/sourceVerifier";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { createTweetLog, withTweetLog, nestDotKeys } from "../../pipeline/utils/tweetLog";
import { withCostTracker, getCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withWarnings, getWarnings } from "../../pipeline/utils/warnings";

const VERIFIER_TURN = 1;

/** Everything the verifier needs to re-run on an already-published note, plus
 *  the verdict it gave the first time so the two can be compared. */
interface VerifierReplayInputs {
  noteId: string;
  noteText: string;
  sources: string[];
  cnStatus: string;
  postContext: string;
  researcherFindings: string;
  config: BotConfig;
  originalVerdict: unknown;
}

function readLog(logs: Record<string, any>, path: string): any {
  return path.split(".").reduce<any>((node, key) => node?.[key], logs);
}

async function loadReplayInputs(tweetId: string): Promise<VerifierReplayInputs> {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data: note, error: noteError } = await db
    .from("notes")
    .select("note_id, note_text, source_url, cn_status")
    .eq("tweet_id", tweetId)
    .single();
  if (noteError) throw noteError;

  const { data: run, error: runError } = await db
    .from("pipeline_runs")
    .select("logs, bot_config")
    .eq("tweet_id", tweetId)
    .eq("note_id", note.note_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (runError) throw runError;

  const steps = run.logs.note_writer_steps;
  return {
    noteId: note.note_id,
    noteText: note.note_text,
    // The writer's own source list is the verifier's input; notes.source_url is
    // the post-verification survivor, so it would hide any source the original
    // verifier rejected.
    sources: readLog(steps, "note_writer.attempts.0.response.sources") ?? [note.source_url],
    cnStatus: note.cn_status,
    postContext: readLog(steps, "search.messages.0.userMessage"),
    researcherFindings: readLog(steps, "search.messages.1.content.findings"),
    config: { ...DEFAULT_CONFIG, ...run.bot_config },
    originalVerdict: readLog(steps, `source_verifier.turn.${VERIFIER_TURN}.messages.1.content`),
  };
}

async function main(): Promise<void> {
  const tweetId = process.argv[2];
  if (!tweetId) throw new Error("usage: runVerifier.ts <tweet-id>");

  const note = await loadReplayInputs(tweetId);

  console.log(`note_id      ${note.noteId}`);
  console.log(`cn_status    ${note.cnStatus}`);
  console.log(`sources      ${note.sources.join("\n             ")}`);
  console.log(`verifier     ${note.config.verifier_model} (claim_based=${note.config.verifier_claim_based}, citations=${note.config.verifier_citations})`);
  console.log(`\nnote:\n${note.noteText}\n`);
  console.log("=== ORIGINAL verdict (from the prod run) ===");
  console.log(JSON.stringify(note.originalVerdict, null, 2));

  const log = createTweetLog();
  // Cost entries and warnings live in AsyncLocalStorage, so they have to be
  // read inside the runners — hence returned alongside the verdict, not printed
  // in there.
  const { verification, costEntries, warnings } = await withBotConfig(note.config, () =>
    withTweetLog(log, () =>
      withWarnings(() =>
        withCostTracker(async () => ({
          verification: await verifySources({
            noteText: note.noteText,
            sources: note.sources,
            postContext: note.postContext,
            researcherFindings: note.researcherFindings,
            turnNumber: VERIFIER_TURN,
          }),
          costEntries: getCostTracker(),
          warnings: getWarnings(),
        })),
      ),
    ),
  );

  const totalCost = costEntries.reduce((sum, entry) => sum + entry.cost, 0);
  console.log(`\n[cost] $${totalCost.toFixed(4)} over ${costEntries.length} call(s)`);
  for (const warning of warnings) console.log(`[warning] ${warning}`);

  console.log("\n=== RERUN verdict ===");
  console.log(JSON.stringify(verification, null, 2));

  const outPath = `${import.meta.dir}/result_${tweetId}.json`;
  await Bun.write(
    outPath,
    JSON.stringify({ note, verification, log: nestDotKeys(Object.fromEntries(log)) }, null, 2),
  );
  console.log(`\nwrote ${outPath}`);
}

await main();

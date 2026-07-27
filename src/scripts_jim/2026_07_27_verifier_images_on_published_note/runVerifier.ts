/**
 * Re-run ONLY the source verifier on a note that is already in the DB, once
 * with verifier_sees_images off and once with it on, and print both verdicts
 * next to the verdict the note actually shipped with.
 *
 * Isolates this branch's change: no search, no writer, no judge, so a run can't
 * be lost to search deciding the post needs no correction. Post images come
 * from the stored run's Gemini media result, so the verifier sees exactly the
 * media the live pipeline had.
 *
 *   bun run src/scripts_jim/2026_07_27_verifier_images_on_published_note/runVerifier.ts <tweet-id>
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { verifySources, type SourceVerification } from "../../pipeline/verify/sourceVerifier";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { createTweetLog, withTweetLog, nestDotKeys } from "../../pipeline/utils/tweetLog";
import { withCostTracker, getCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withWarnings, getWarnings } from "../../pipeline/utils/warnings";
import type { GeminiMediaResult } from "../../pipeline/media/mediaAnalysisGemini";
import { verifierModelSupportsImages } from "../../pipeline/verify/verifierImages";

const VERIFIER_TURN = 1;

/** Everything the verifier needs to re-run on an already-published note, plus
 *  the verdict it gave the first time so the arms can be compared against it. */
interface VerifierReplayInputs {
  noteId: string;
  noteText: string;
  sources: string[];
  cnStatus: string;
  postContext: string;
  researcherFindings: string;
  mediaResult: GeminiMediaResult;
  config: BotConfig;
  originalVerdict: unknown;
}

interface ArmResult {
  seesImages: boolean;
  verification: SourceVerification;
  costUsd: number;
  warnings: string[];
  log: Record<string, unknown>;
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
    mediaResult: {
      tweetMedia: readLog(run.logs, "media.gemini.tweetMedia") ?? [],
      quotedTweetMedia: readLog(run.logs, "media.gemini.quotedTweetMedia") ?? [],
    },
    config: { ...DEFAULT_CONFIG, ...run.bot_config },
    originalVerdict: readLog(steps, `source_verifier.turn.${VERIFIER_TURN}.messages.1.content`),
  };
}

async function runArm(note: VerifierReplayInputs, seesImages: boolean): Promise<ArmResult> {
  const log = createTweetLog();
  // Cost entries and warnings live in AsyncLocalStorage, so they have to be
  // read inside the runners rather than after they unwind.
  const { verification, costEntries, warnings } = await withBotConfig(
    { ...note.config, verifier_sees_images: seesImages },
    () =>
      withTweetLog(log, () =>
        withWarnings(() =>
          withCostTracker(async () => ({
            verification: await verifySources({
              noteText: note.noteText,
              sources: note.sources,
              postContext: note.postContext,
              researcherFindings: note.researcherFindings,
              mediaResult: note.mediaResult,
              turnNumber: VERIFIER_TURN,
            }),
            costEntries: getCostTracker(),
            warnings: getWarnings(),
          })),
        ),
      ),
  );

  return {
    seesImages,
    verification,
    costUsd: costEntries.reduce((sum, entry) => sum + entry.cost, 0),
    warnings,
    log: nestDotKeys(Object.fromEntries(log)),
  };
}

function printArm(arm: ArmResult): void {
  console.log(`\n=== RERUN verifier_images=${arm.seesImages ? "on" : "off"} ===`);
  console.log(`accepted: ${arm.verification.accepted}`);
  console.log(`reasoning: ${arm.verification.reasoning}`);
  console.log(`good: ${arm.verification.good_sources.join(", ") || "(none)"}`);
  console.log(`bad:  ${arm.verification.bad_sources.join(", ") || "(none)"}`);
  console.log(`[cost] $${arm.costUsd.toFixed(4)}`);
  for (const warning of arm.warnings) console.log(`[warning] ${warning}`);
}

async function main(): Promise<void> {
  const tweetId = process.argv[2];
  if (!tweetId) throw new Error("usage: runVerifier.ts <tweet-id>");

  const note = await loadReplayInputs(tweetId);
  const postImages = note.mediaResult.tweetMedia.filter((m) => m.type === "image");

  // The feature is a silent no-op on a text-only verifier, which would read as
  // "images changed nothing" rather than "images were never sent".
  const verifierModel = note.config.verifier_model ?? note.config.model;
  if (!verifierModelSupportsImages(verifierModel)) {
    throw new Error(
      `${verifierModel} is not vision-capable — the on-arm would send no images. ` +
        `Replay a note whose run used a vision verifier, or override verifier_model.`,
    );
  }

  console.log(`note_id      ${note.noteId}`);
  console.log(`cn_status    ${note.cnStatus}`);
  console.log(`verifier     ${note.config.verifier_model} (claim_based=${note.config.verifier_claim_based}, citations=${note.config.verifier_citations})`);
  console.log(`post images  ${postImages.map((m) => m.url).join("\n             ") || "(none)"}`);
  if (postImages.length === 0) {
    // Without post media the on-arm can only differ via images pulled from the
    // cited sources — worth saying out loud, since a silently-empty media
    // result looks exactly like "images made no difference".
    console.log("             ^ no post media: the arms differ only by cited-source images");
  }
  console.log(`sources      ${note.sources.join("\n             ")}`);
  console.log(`\nnote:\n${note.noteText}\n`);
  console.log("=== ORIGINAL verdict (prod run, pre-branch) ===");
  console.log(JSON.stringify(note.originalVerdict, null, 2));

  // Sequential, not parallel: the two arms share the source-fetch path and the
  // free-tier Gemini key, and a rate-limited second arm would read as a verdict
  // difference.
  const arms: ArmResult[] = [];
  for (const seesImages of [false, true]) {
    const arm = await runArm(note, seesImages);
    printArm(arm);
    arms.push(arm);
  }

  const outPath = `${import.meta.dir}/result_${tweetId}.json`;
  await Bun.write(outPath, JSON.stringify({ note, arms }, null, 2));
  console.log(`\nwrote ${outPath}`);
}

await main();

/**
 * Fact-checks one extracted claim. The claim is wrapped in a synthetic post and
 * that post runs through the normal note pipeline. We run it on simple-bot with
 * the claim-check search prompt and with the note-needed prefilter turned off.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { getBotById } from "../../bots/index";
import { processSingleTweet } from "../../pipeline/orchestration/processTweet";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { createTweetLog, getLoggedBotIdentity, nestDotKeys, withTweetLog, type TweetLogMap } from "../../pipeline/utils/tweetLog";
import type { TokenCost } from "../../pipeline/cost-tracking/pricing";
import type { EvaluatedSource } from "../../pipeline/prompts/verify/citations";
import { insertClaimPipelineRun } from "../db";
import type { ClaimCheck, ExtractedClaim, ItemSource, NoteSourceCitation } from "../types";

// We run simple-bot with the note-needed prefilter turned off, so every checked
// claim goes through the full search and write path. The prefilter was dropping
// too many claims that were worth checking. We also force the claim-check search
// prompt, because a claim here is an excerpt from a transcript or an article and
// not an X post.
// The models are pinned. Search runs on Opus 5, the writer on Sonnet 5, and the
// source verifier on Gemini 3 Flash.
// verifier_citations is on, so every accepted source carries a verbatim
// supporting quote and an explanation. We save those per source.
// verifier_claim_based is pinned to "classic", the single-call flow that accepts
// or rejects a source in one go. Without pinning it the 50/50 AB test would send
// half the claims through the two-call claim-based verifier instead.
const FORCED_PICKS: Record<string, string> = {
  bot: "simple-bot",
  note_prefilter: "off",
  search_claim: "on",
  simple_bot_search: "opus5-native",
  simple_bot_writer: "sonnet5",
  simple_bot_verifier: "gemini-flash",
  verifier_citations: "on",
  verifier_claim_based: "classic",
};

export interface ClaimPostParams {
  claim: ExtractedClaim;
  source: ItemSource;
  /** The everything_items.id. The synthetic post id built from it contains a
   *  hyphen, so it can never be mistaken for a real tweet id. */
  itemId: string;
  /** The everything_claims.id. The run record with its logs and cost is keyed to
   *  it. Passing null skips recording the run, which is what the debug harnesses
   *  and ad-hoc scripts do. */
  claimId: string | null;
  index: number;
  /** The date the content was published. It becomes the synthetic post's posting
   *  date, the same way the tweet pipeline uses a tweet's date. */
  publishedAt?: string;
}

// We fact-check the author's own words. The synthetic post carries the verbatim
// highlighted span, the passage around it, and any images the claim rests on. It
// does not carry Opus's neutral restatement of the claim. That restatement is
// useful during extraction, because it forces Opus to state the claim, but it
// can drift away from the source. So we keep it out of the fact-check input and
// let the search model read what the author actually wrote. The surrounding
// passage contains the highlighted span word for word, and labelling the span
// separately tells the model which part of the passage to check.
// There is one exception. A claim with no highlighted span is grounded in an
// image, and a single image such as an infographic can carry several claims. In
// that case the restatement is the only thing that says which claim to check, so
// it goes back in. The images themselves reach the model through the pipeline's
// media analysis.
export function buildClaimPost(params: ClaimPostParams): Post {
  const { claim, source, itemId, index, publishedAt } = params;
  const origin = source === "youtube" ? "Transcript" : "Article";
  const highlighted = claim.context.trim();
  const paragraph = claim.contextParagraph.trim();
  const lines: string[] = [];
  if (highlighted) lines.push(`Highlighted claim from ${origin}: ${highlighted}`);
  else lines.push(`Claim: ${claim.claim}`);
  if (paragraph) lines.push(`Surrounding context: ${paragraph}`);
  return {
    id: `${itemId.slice(0, 8)}-${index}`,
    author_id: "unknown",
    created_at: publishedAt ?? new Date().toISOString(),
    text: lines.join("\n"),
    media: claim.imageUrls.map((url) => ({ type: "photo", url })),
  };
}

export async function checkClaim(params: ClaimPostParams): Promise<ClaimCheck> {
  const post = buildClaimPost(params);

  const { config, picks } = withForcedPicks(FORCED_PICKS, () => runABTests(AB_TESTS));
  const bot = getBotById(config.botId);
  if (!bot) throw new Error(`No bot registered for id "${config.botId}"`);

  const log = createTweetLog();
  const result = await withTweetLog(log, () =>
    withBotConfig(config, () =>
      withCostTracker(() => {
        log.set("bot.id", config.botId);
        log.set("bot.picks", picks);
        return processSingleTweet({ post, bot, logger: null });
      }),
    ),
  );

  if (params.claimId) await recordClaimRun(params.claimId, result, log);

  if (result.outcome === "candidate") {
    return {
      kind: "note",
      note: result.pipelineResult?.noteResult.note ?? "",
      sources: buildSourceCitations(
        result.pipelineResult?.searchContextResult.citations ?? [],
        result.pipelineResult?.sourceEvaluations ?? [],
      ),
    };
  }
  return { kind: "no_note", outcome: result.outcome, reason: result.outcomeReason ?? null };
}

/** Saves the run's tweet log and LLM cost to everything_pipeline_runs. This is
 *  best effort. A failure to record must never make the claim itself fail. */
async function recordClaimRun(
  claimId: string,
  result: Awaited<ReturnType<typeof processSingleTweet>>,
  log: TweetLogMap,
): Promise<void> {
  const bot = getLoggedBotIdentity("simple-bot", log);
  try {
    await insertClaimPipelineRun({
      claim_id: claimId,
      bot_name: bot.name,
      outcome: result.outcome,
      outcome_reason: result.outcomeReason ?? null,
      final_stage: result.finalStage ?? null,
      ab_test_picks: bot.picks ?? null,
      bot_config: bot.config ?? null,
      logs: nestDotKeys(Object.fromEntries(log)),
      cost: (log.get("costs.total") as TokenCost | undefined)?.cost ?? null,
    });
  } catch (err: any) {
    console.warn(`  [checkClaim] failed to record pipeline run for claim ${claimId}: ${err?.message}`);
  }
}

/** Expands each cited URL into one entry per supporting snippet the verifier
 *  extracted. A URL with no snippet becomes a single entry holding just the URL,
 *  so the note still shows its source. That happens when verifier_citations is
 *  off, or when the verifier quoted nothing from that source. */
function buildSourceCitations(citedUrls: string[], evaluations: EvaluatedSource[]): NoteSourceCitation[] {
  const byUrl = new Map(evaluations.map((e) => [e.url, e]));
  return citedUrls.flatMap((url): NoteSourceCitation[] => {
    const citations = byUrl.get(url)?.citations ?? [];
    if (citations.length === 0) return [{ url, quote: null, explanation: null }];
    return citations.map((c) => ({ url, quote: c.quote, explanation: c.explanation || null }));
  });
}

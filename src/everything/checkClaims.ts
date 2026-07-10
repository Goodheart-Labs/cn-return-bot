/**
 * Fact-check one extracted claim by running it through the normal note
 * pipeline (simple-bot + note-needed prefilter + claim-check search prompt)
 * as a synthetic post.
 */

import type { Post } from "../api/fetchEligiblePosts";
import { getBotById } from "../bots/index";
import { processSingleTweet } from "../pipeline/orchestration/processTweet";
import { withBotConfig } from "../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../pipeline/ab-testing/abTestsData";
import { createTweetLog, withTweetLog } from "../pipeline/utils/tweetLog";
import type { ClaimCheck, ExtractedClaim, SourceKind } from "./types";

// simple-bot with the cheap note-needed prefilter and the claim-check search
// prompt (every claim here is an excerpt from a transcript/article, not an X post).
const FORCED_PICKS: Record<string, string> = { bot: "simple-bot", note_prefilter: "deepseek", search_claim: "on" };

export interface ClaimPostParams {
  claim: ExtractedClaim;
  source: SourceKind;
  /** everything_items.id — hyphenated in the post id so it never looks like a real tweet id. */
  itemId: string;
  index: number;
  /** Content publication date; the claim's "posted" date (mirrors the tweet pipeline). */
  publishedAt?: string;
}

// Fact-check the claim WITH its context excerpt, not in isolation: the
// surrounding text carries nuance the neutral restatement drops.
function buildClaimPost(params: ClaimPostParams): Post {
  const { claim, source, itemId, index, publishedAt } = params;
  const origin = source === "youtube" ? "Transcript" : "Article";
  return {
    id: `${itemId.slice(0, 8)}-${index}`,
    author_id: "unknown",
    created_at: publishedAt ?? new Date().toISOString(),
    text: `Text from ${origin}: ${claim.context.trim()}\nClaim: ${claim.claim}`,
    media: [],
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

  if (result.outcome === "candidate") {
    return {
      kind: "note",
      note: result.pipelineResult?.noteResult.note ?? "",
      sources: result.pipelineResult?.searchContextResult.citations ?? [],
    };
  }
  return { kind: "no_note", outcome: result.outcome, reason: result.outcomeReason ?? null };
}

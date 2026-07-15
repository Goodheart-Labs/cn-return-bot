/**
 * Fact-check one extracted claim by running it through the normal note
 * pipeline (simple-bot + note-needed prefilter + claim-check search prompt)
 * as a synthetic post.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { getBotById } from "../../bots/index";
import { processSingleTweet } from "../../pipeline/orchestration/processTweet";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import type { EvaluatedSource } from "../../pipeline/prompts/verify/citations";
import type { ClaimCheck, ExtractedClaim, NoteSourceCitation, SourceKind } from "../types";

// simple-bot with the note-needed prefilter OFF (every checked claim goes through
// full search + write; the prefilter was dropping too many checkable claims) and
// the claim-check search prompt (each claim is a transcript/article excerpt, not an X post).
// Pinned models: search on Opus 4.8 (opus48-native), writer on Sonnet 5 (the
// sonnet5 writer arm), verifier on Gemini 3 Flash. verifier_citations ON so
// accepted sources carry a verbatim supporting quote + explanation (persisted
// per source). verifier_claim_based "classic" pins the single-call accept/reject
// flow (non-claim-based) — otherwise the 50/50 AB test would send half the claims
// through the two-call claim-based verifier.
const FORCED_PICKS: Record<string, string> = {
  bot: "simple-bot",
  note_prefilter: "off",
  search_claim: "on",
  simple_bot_search: "opus48-native",
  simple_bot_writer: "sonnet5",
  simple_bot_verifier: "gemini-flash",
  verifier_citations: "on",
  verifier_claim_based: "classic",
};

export interface ClaimPostParams {
  claim: ExtractedClaim;
  source: SourceKind;
  /** everything_items.id — hyphenated in the post id so it never looks like a real tweet id. */
  itemId: string;
  index: number;
  /** Content publication date; the claim's "posted" date (mirrors the tweet pipeline). */
  publishedAt?: string;
}

// Fact-check the claim WITH its surrounding passage (and any images it rests
// on), not in isolation: the wider context carries nuance the neutral
// restatement drops. Image-only claims carry no text excerpt — just the claim
// and the image(s), which the pipeline's media analysis describes.
function buildClaimPost(params: ClaimPostParams): Post {
  const { claim, source, itemId, index, publishedAt } = params;
  const origin = source === "youtube" ? "Transcript" : "Article";
  const passage = (claim.contextParagraph || claim.context).trim();
  const textLine = passage ? `Text from ${origin}: ${passage}\n` : "";
  return {
    id: `${itemId.slice(0, 8)}-${index}`,
    author_id: "unknown",
    created_at: publishedAt ?? new Date().toISOString(),
    text: `${textLine}Claim: ${claim.claim}`,
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

/** Expand each cited URL into one entry per supporting snippet the verifier
 *  extracted; a URL with no snippet (verifier_citations off, or nothing quoted)
 *  becomes a single bare-URL entry so the note still shows its source. */
function buildSourceCitations(citedUrls: string[], evaluations: EvaluatedSource[]): NoteSourceCitation[] {
  const byUrl = new Map(evaluations.map((e) => [e.url, e]));
  return citedUrls.flatMap((url): NoteSourceCitation[] => {
    const citations = byUrl.get(url)?.citations ?? [];
    if (citations.length === 0) return [{ url, quote: null, explanation: null }];
    return citations.map((c) => ({ url, quote: c.quote, explanation: c.explanation || null }));
  });
}

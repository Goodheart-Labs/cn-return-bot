/**
 * One-off: run the source verifier on the "Phoenix" note with Gemini 3 Flash
 * and verifier_citations ON, matching the everything pipeline's config.
 */

import { DEFAULT_CONFIG, withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { verifySources } from "../../pipeline/verify/sourceVerifier";

const noteText =
  "Phoenix is a real X algorithm update (the Grok-based transformer replacing the legacy Heavy Ranker), but it launched January 20, 2026, not around April 1. No source shows a Phoenix release near April 1.";

const sources = [
  "https://www.socialmediatoday.com/news/x-formerly-twitter-publishes-ai-powered-algorithm-code/810015/",
  "https://github.com/xai-org/x-algorithm",
];

// Background context (what the note is correcting). Not a source; only shown so
// the verifier understands the claim. No original post was supplied, so this is
// a reconstruction from the note's subject.
const postContext =
  "Post claims that X rolled out its new 'Phoenix' algorithm (the Grok-based ranking model) around April 1, 2026.";

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botId: "simple-bot",
  model: "anthropic/claude-sonnet-5",
  verifier_model: "google/gemini-3-flash-preview",
  verifier_citations: true,
  // classic flow (verifier_claim_based defaults off), same as the everything pipeline
};

const log = createTweetLog();

const result = await withTweetLog(log, () =>
  withBotConfig(config, () =>
    withCostTracker(() =>
      verifySources({ noteText, sources, postContext, turnNumber: 1 }),
    ),
  ),
);

const messages = log.get("note_writer_steps.source_verifier.turn.1.messages.0") as
  | { systemPrompt: string; userMessage: string }
  | undefined;

console.log("========== SYSTEM PROMPT ==========\n");
console.log(messages?.systemPrompt ?? "(not logged)");
console.log("\n========== USER MESSAGE ==========\n");
console.log(messages?.userMessage ?? "(not logged)");
console.log("\n========== RESULT ==========\n");
console.log(JSON.stringify(result, null, 2));

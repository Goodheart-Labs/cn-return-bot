/**
 * Runs one tweet's full compute inside fresh ambient contexts: its own tweet
 * log, warnings, cost tracker, the drawn bot config, and the monitoring
 * context when the post came from a curated topic. This is the service-side
 * counterpart of the wrapping generateCandidates used to do around
 * processSingleTweet, so the drawn picks and the log entries come out the
 * same.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { getBotById } from "../../bots/index";
import { runABTests, withForcedPicks } from "../ab-testing/abTests";
import { AB_TESTS } from "../ab-testing/abTestsData";
import { withBotConfig } from "../ab-testing/botConfig";
import { withCostTracker } from "../cost-tracking/costTracker";
import { withMonitoringContext, type MonitoringContext } from "../misinfo-monitoring/monitoringContext";
import { createTweetLog, withTweetLog } from "../utils/tweetLog";
import { withWarnings } from "../utils/warnings";
import { computeTweetResult, type TweetComputeOutput } from "./processTweet";

export async function runTweetCheck(
  post: Post,
  forcedPicks: Record<string, string>,
  monitoring: MonitoringContext | undefined,
): Promise<TweetComputeOutput> {
  // The caller forces only what it already decided, such as the feed tier the
  // post came from. Everything else is drawn here, once, so a run's picks stay
  // a single draw exactly as they were in-process.
  const { config, picks } = withForcedPicks(forcedPicks, () => runABTests(AB_TESTS));
  const bot = getBotById(config.botId);
  if (!bot) throw new Error(`No bot registered for id "${config.botId}" picked by AB_TESTS`);

  const log = createTweetLog();
  return withTweetLog(log, () =>
    withWarnings(() =>
      withMonitoringContext(monitoring, () =>
        withBotConfig(config, () =>
          withCostTracker(() => {
            log.set("bot.id", config.botId);
            log.set("bot.picks", picks);
            log.set("bot.config", config);
            return computeTweetResult(post, bot);
          }),
        ),
      ),
    ),
  );
}

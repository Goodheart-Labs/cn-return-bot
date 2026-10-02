/**
 * The notify service: posts good Common Notes to Slack as the bot "Claudy"
 * (GOO-228). announcements.ts describes the four channels.
 *
 * Once a minute it reads the notes and votes of the last day, posts every event
 * that has no row in everything_slack_announcements yet, and then writes that
 * row. The window is a day long, so the service can be down for most of a day
 * without missing anything. On its very first start it also posts the events of
 * the day before.
 *
 * A message is posted before its row is written. If the service dies between
 * the two, the next start posts that message a second time. We prefer a rare
 * duplicate to a lost announcement.
 *
 *   bun run src/service/notify/main.ts
 */

import "dotenv/config";
import { postSlackMessage } from "../../utils/slack";
import { requiredEnv } from "../serve";
import { dropAnnounced, findAnnouncements, recordAnnouncement, type SlackChannel } from "./announcements";

const CHECK_INTERVAL_MS = 60_000;
const LOOKBACK_MS = 24 * 3600_000;

/** Each channel's Slack id comes from its own environment variable, as
 *  ops/README.md asks, so the code never contains one. */
const CHANNEL_ID_VARIABLES: Record<SlackChannel, string> = {
  on_important_creator: "SLACK_CHANNEL_ON_IMPORTANT_CREATOR",
  written_by_human: "SLACK_CHANNEL_WRITTEN_BY_HUMAN",
  first_helpful_vote: "SLACK_CHANNEL_FIRST_HELPFUL_VOTE",
  helpful: "SLACK_CHANNEL_HELPFUL",
};

async function announceNewEvents(channelIds: Record<SlackChannel, string>): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  for (const announcement of await dropAnnounced(await findAnnouncements(since))) {
    for (const markdown of announcement.messages) {
      await postSlackMessage({ channel: channelIds[announcement.channel], markdown });
    }
    await recordAnnouncement(announcement);
    console.log(`[notify] posted to ${announcement.channel}: ${announcement.subjectId}`);
  }
}

async function main() {
  requiredEnv("SLACK_BOT_TOKEN");
  const channelIds = Object.fromEntries(
    Object.entries(CHANNEL_ID_VARIABLES).map(([channel, variable]) => [channel, requiredEnv(variable)]),
  ) as Record<SlackChannel, string>;
  console.log("[notify] watching notes and votes");
  for (;;) {
    // A thrown check crashes the process on purpose. systemd restarts it, and
    // a crash loop is a loud signal where a swallowed error would be silence.
    await announceNewEvents(channelIds);
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("[notify] Fatal error:", err);
  process.exit(1);
});

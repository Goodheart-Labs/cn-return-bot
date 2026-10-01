/**
 * Posts Slack messages as the bot "Claudy".
 *
 * The bot token comes from SLACK_BOT_TOKEN. On the services machine it lives in
 * /etc/cn-return-bot/service.env, and in GitHub Actions it is a repository
 * secret. The bot can only post in channels it has been invited to.
 *
 * Slack answers a refused message with HTTP 200 and `ok: false`, so we check
 * that field and throw with Slack's error code. A caller never believes a
 * message arrived when it did not.
 */

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const SLACK_TIMEOUT_MS = 30_000;

export type SlackMessage = {
  /** A channel id such as C08ABCDEF, from the channel's details in Slack. */
  channel: string;
  /** Ordinary Markdown, at most 12,000 characters. */
  markdown: string;
  /** The timestamp of the message that starts the thread this reply goes into. */
  threadTs?: string;
};

type PostMessageResponse = { ok: true; ts: string } | { ok: false; error: string };

/** Returns the new message's timestamp, which a later reply passes as `threadTs`. */
export async function postSlackMessage(message: SlackMessage): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing required environment variable: SLACK_BOT_TOKEN");
  const response = await fetch(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: message.channel, markdown_text: message.markdown, thread_ts: message.threadTs }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  const result = (await response.json()) as PostMessageResponse;
  if (!result.ok) throw new Error(`Slack refused the message to ${message.channel}: ${result.error}`);
  return result.ts;
}

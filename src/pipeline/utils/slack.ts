/* Posts one Slack message as the bot "Claudy", the same Slack app the devbox's
 * standing jobs post as. Its bot token is the GitHub secret SLACK_BOT_TOKEN. */

/** The channel the Claude note writers report to, the same one the devbox's
 *  slack-bridge forwards to the note writer's session there. cn-walk's
 *  silence watch and the runner's alerts post here. */
export const NOTEWRITERS_SLACK_CHANNEL = "C0CATM96UR1";

export async function postToSlack(channel: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set, so the Slack message could not be sent");
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text }),
  });
  // Slack answers HTTP 200 also when it refuses a message, and says so in `ok`.
  const body = (await response.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(`Slack refused the message: ${body.error ?? `HTTP ${response.status}`}`);
}

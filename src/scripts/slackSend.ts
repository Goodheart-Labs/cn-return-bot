/**
 * Posts one Slack message as the bot "Claudy" and prints its timestamp.
 * Its main use is checking that SLACK_BOT_TOKEN works on a machine.
 *
 *   bun run slack-send <channel id> <markdown text>
 */

import { postSlackMessage } from "../utils/slack";

const [channel, ...words] = process.argv.slice(2);
if (!channel || words.length === 0) {
  console.error("usage: bun run slack-send <channel id> <markdown text>");
  process.exit(1);
}
console.log(await postSlackMessage({ channel, markdown: words.join(" ") }));

import { expect, test } from "bun:test";
import { problemStarted, tellSlack } from "./alerts";

test("an alert Slack cannot take goes to the log and does not throw", async () => {
  const saved = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  try {
    await expect(tellSlack("test alert")).resolves.toBeUndefined();
    await expect(problemStarted("usage", "test problem")).resolves.toBeUndefined();
  } finally {
    if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
  }
});

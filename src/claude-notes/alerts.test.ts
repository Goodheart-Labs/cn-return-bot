import { expect, spyOn, test } from "bun:test";
import { problemStarted, tellSlack } from "./alerts";

test("an alert Slack cannot take goes to the log, does not throw, and is tried again", async () => {
  const saved = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await tellSlack("test alert")).toBe(false);
    await problemStarted("usage", "test problem");
    await problemStarted("usage", "test problem");
    // Both tries reached the log: a failed alert does not mark the problem as sent.
    expect(log.mock.calls.filter(([line]) => String(line).includes("test problem")).length).toBe(2);
  } finally {
    log.mockRestore();
    if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
  }
});

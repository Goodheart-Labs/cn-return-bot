import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { postSlackMessage } from "./slack";

const MESSAGE = { channel: "C0TEST", markdown: "hello *world*", threadTs: "1727771234.567890" };

describe("postSlackMessage", () => {
  const savedToken = process.env.SLACK_BOT_TOKEN;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  beforeEach(() => { process.env.SLACK_BOT_TOKEN = "xoxb-test"; });
  afterEach(() => {
    fetchSpy?.mockRestore();
    if (savedToken === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = savedToken;
  });

  function answerWith(body: object) {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
  }

  test("sends the token, channel, Markdown and thread, and returns the new message's timestamp", async () => {
    answerWith({ ok: true, ts: "1727771300.000100" });
    expect(await postSlackMessage(MESSAGE)).toBe("1727771300.000100");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse(init.body as string)).toEqual({ channel: "C0TEST", markdown_text: "hello *world*", thread_ts: "1727771234.567890" });
  });

  test("throws with Slack's error when Slack refuses the message", async () => {
    answerWith({ ok: false, error: "not_in_channel" });
    await expect(postSlackMessage(MESSAGE)).rejects.toThrow("Slack refused the message to C0TEST: not_in_channel");
  });

  test("throws before calling Slack when the token is missing", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    answerWith({ ok: true, ts: "1" });
    await expect(postSlackMessage(MESSAGE)).rejects.toThrow("SLACK_BOT_TOKEN");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { describe, expect, test } from "bun:test";
import { NO_IMAGES, postPrompt, tweetPrompt } from "./prompts";

// Fakes carry only what the prompt builders read; the rest is cast away.
const item = { id: "item-1", url: "https://example.com/post", title: "A post" } as any;
const tweet = { runId: "run-1", input: "A tweet", picks: {} } as any;

describe("writer prompts never ask for images", () => {
  for (const host of ["ai-box", "devbox"] as any[]) {
    test(`post prompt on ${host}`, () => {
      const p = postPrompt({ host, item, dir: "/d", runDir: "/r", runId: "run-1", picks: {}, asked: { requests: [] } as any });
      expect(p).toContain(NO_IMAGES);
      expect(p).not.toMatch(/download them|look at them/);
    });
    test(`tweet prompt on ${host}`, () => {
      const p = tweetPrompt({ host, tweet, runDir: "/r" });
      expect(p).toContain(NO_IMAGES);
      expect(p).not.toMatch(/download them|look at them/);
    });
  }
});

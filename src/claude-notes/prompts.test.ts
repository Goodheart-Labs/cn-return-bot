import { describe, expect, test } from "bun:test";
import { NO_IMAGES, postPrompt, tweetPrompt } from "./prompts";

// Fakes carry only what the prompt builders read; the rest is cast away.
const item = { id: "item-1", url: "https://example.com/post", title: "A post" } as any;
const tweet = { runId: "run-1", input: "A tweet", picks: {} } as any;

describe("writer prompts never ask for images", () => {
  test("post prompt", () => {
    const p = postPrompt({ item, dir: "/d", runDir: "/r", picks: {}, asked: { requests: [] } as any });
    expect(p).toContain(NO_IMAGES);
    expect(p).not.toMatch(/download (them|the images)|look at (them|the images)|If the post has images/);
  });
  test("tweet prompt", () => {
    const p = tweetPrompt({ tweet, runDir: "/r" });
    expect(p).toContain(NO_IMAGES);
    expect(p).not.toMatch(/download (them|the images)|look at (them|the images)|If the post has images/);
  });
});

describe("a post that is checked again", () => {
  const prompt = (asked: any) => postPrompt({ item, dir: "/d", runDir: "/r", picks: {}, asked });
  const long = "x".repeat(300);
  test("lists the passages that already have a draft, cut to 200 characters", () => {
    const p = prompt({ requests: [], onlyThese: false, alreadyChecked: ["GDP fell 3%", long] });
    expect(p).toContain("## Passages already checked");
    expect(p).toContain('1. "GDP fell 3%"');
    expect(p).toContain(`2. "${"x".repeat(200)}…"`);
    expect(p).not.toContain("unless readers asked");
  });
  test("a first check has no such section", () => {
    expect(prompt({ requests: [], onlyThese: false, alreadyChecked: [] })).not.toContain("already checked");
    expect(prompt({ requests: [], onlyThese: false })).not.toContain("already checked");
  });
  test("a reader's passage still gets its draft", () => {
    const requests = [{ passage: "GDP fell 3%", reason: null }];
    expect(prompt({ requests, onlyThese: false, alreadyChecked: ["GDP fell 3%"] })).toContain("unless readers asked about it above");
    expect(prompt({ requests, onlyThese: true, alreadyChecked: ["GDP fell 3%"] })).not.toContain("## Passages already checked");
  });
});

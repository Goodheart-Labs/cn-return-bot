import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftingAdapter, DraftResult, TweetInspection } from "../signal-bot/drafting";
import { parseDraftTweetArgs, runDraftTweets } from "./draftTweets";
import { addWarning } from "../pipeline/utils/warnings";

const firstId = "2099621874279817638";
const secondId = "2099621874279817639";
const note = { text: "The original record gives a different date.", sources: ["https://example.org/record"] };
let directory: string;

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "local-tweet-drafts-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function readable(tweetId: string): TweetInspection {
  return {
    tweetId, access: "readable", eligibility: "unconfirmed", detail: "Tweet is readable.",
    post: { id: tweetId, text: "An original factual claim.", author_id: "42", created_at: "2026-09-16T12:00:00Z", media: [] },
  };
}

function fixture(overrides: Partial<DraftingAdapter> = {}) {
  const inspect = mock(overrides.inspect ?? (async (tweetId: string) => readable(tweetId)));
  const draft = mock(overrides.draft ?? (async (): Promise<DraftResult> => ({
    reply: "Proposed draft based on the research and source check.",
    draft: note, research: "The original record gives the date as 2017.",
  })));
  const log = mock((_text: string) => {});
  const closeBrowser = mock(async () => {});
  const outputDir = join(directory, "results");
  return {
    inspect, draft, log, closeBrowser, outputDir,
    run: (inputs: string[]) => runDraftTweets(["--output-dir", outputDir, ...inputs], {
      adapter: { inspect, draft }, log, closeBrowser,
      now: () => new Date("2026-09-16T12:00:00Z"),
    }),
    output: () => log.mock.calls.map(([text]) => text).join("\n"),
  };
}

describe("local tweet drafting", () => {
  test("accepts tweet IDs and supported URL forms, preserving order and deduplicating IDs", () => {
    expect(parseDraftTweetArgs([
      firstId, `https://x.com/person/status/${firstId}?s=20`,
      `https://mobile.twitter.com/i/web/status/${secondId}`, `https://www.x.com/i/status/${secondId}/photo/1`,
    ]).tweetIds).toEqual([firstId, secondId]);
  });

  test.each([
    "https://example.org/person/status/123", "https://x.com.evil.test/person/status/123",
    "https://x.com/person", "https://user:password@x.com/person/status/123", "https://x.com:8443/person/status/123",
    "file:///person/status/123", "123abc", "12345678901234567890123456",
  ])("rejects unsupported input: %s", (input) => {
    expect(() => parseDraftTweetArgs([input])).toThrow("Each input must be");
  });

  test("help is offline and does not create an output directory", async () => {
    const f = fixture();
    expect(await f.run(["--help"])).toBe(0);
    expect(f.output()).toContain("Usage:");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.draft).not.toHaveBeenCalled();
    expect(f.closeBrowser).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  test("invalid flags fail before any inspection", async () => {
    const f = fixture();
    expect(await f.run(["--unknown", firstId])).toBe(1);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
    expect(() => parseDraftTweetArgs(["--output-dir"])).toThrow("followed by a directory");
  });

  test("reports and saves full drafts, sources, length, research, and private files", async () => {
    const f = fixture();
    expect(await f.run([firstId, `https://twitter.com/person/status/${firstId}`])).toBe(0);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(f.draft.mock.calls[0]![0]).toEqual({
      post: readable(firstId).post!,
      history: [{ role: "user", content: `https://x.com/i/web/status/${firstId}` }],
    });
    const path = join(f.outputDir, `${firstId}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.status).toBe("draft");
    expect(saved.result.draft).toEqual(note);
    expect(saved.result.research).toContain("2017");
    expect(saved.noteText).toBe(`${note.text} ${note.sources[0]}`);
    expect(saved.characterCount).toBe(note.text.length + 2);
    expect(f.output()).toContain(saved.noteText);
    expect(f.output()).toContain(`${saved.characterCount}/280`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(f.outputDir)).mode & 0o777).toBe(0o700);
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
  });

  test("a failed lookup is saved and never reaches drafting", async () => {
    const f = fixture({ inspect: async (tweetId) => ({
      tweetId, access: "unavailable", eligibility: "unconfirmed",
      detail: "X denied the tweet lookup (HTTP 403). Reply ‘retry’ to try the lookup again.",
    }) });
    expect(await f.run([firstId])).toBe(1);
    expect(f.draft).not.toHaveBeenCalled();
    const saved = JSON.parse(await readFile(join(f.outputDir, `${firstId}.json`), "utf8"));
    expect(saved.status).toBe("lookup_failed");
    expect(f.output()).toContain("HTTP 403");
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
  });

  test("continues after a lookup exception without exposing raw error details", async () => {
    const f = fixture({ inspect: async (tweetId) => {
      if (tweetId === firstId) throw new Error("Authorization: private-api-token");
      return readable(tweetId);
    } });
    expect(await f.run([firstId, secondId])).toBe(1);
    expect(f.inspect).toHaveBeenCalledTimes(2);
    expect(f.draft).toHaveBeenCalledTimes(1);
    expect(f.draft.mock.calls[0]![0].post.id).toBe(secondId);
    const failed = await readFile(join(f.outputDir, `${firstId}.json`), "utf8");
    expect(JSON.parse(failed).status).toBe("error");
    expect(failed + f.output()).not.toContain("private-api-token");
    expect(JSON.parse(await readFile(join(f.outputDir, `${secondId}.json`), "utf8")).status).toBe("draft");
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
  });

  test("continues after a drafting failure and treats supported abstention as a successful run", async () => {
    const f = fixture({ draft: async ({ post }) => {
      if (post.id === firstId) throw new Error("Provider response with private-api-token");
      return { reply: "The evidence supports the tweet.", abstentionReason: "No correction is supported.", research: "Original evidence." };
    } });
    expect(await f.run([firstId, secondId])).toBe(1);
    expect(f.draft).toHaveBeenCalledTimes(2);
    expect(f.output()).not.toContain("private-api-token");
    const saved = JSON.parse(await readFile(join(f.outputDir, `${secondId}.json`), "utf8"));
    expect(saved.status).toBe("no_draft");
    expect(saved.result.research).toBe("Original evidence.");
    expect(saved.noteText).toBeUndefined();
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
    const abstention = fixture({ draft: async () => ({ reply: "No correction is supported.", research: "Evidence." }) });
    expect(await abstention.run(["123"])).toBe(0);
  });

  test("preserves existing results and continues saving the remaining batch", async () => {
    const f = fixture();
    expect(await f.run([firstId])).toBe(0);
    const original = join(f.outputDir, `${firstId}.json`);
    await writeFile(original, "previous result");
    expect(await f.run([firstId, secondId])).toBe(1);
    expect(await readFile(original, "utf8")).toBe("previous result");
    expect(JSON.parse(await readFile(join(f.outputDir, `${secondId}.json`), "utf8")).status).toBe("draft");
  });

  test("captures safe warnings even on failure and keeps each tweet's warnings separate", async () => {
    const f = fixture({ draft: async ({ post }) => {
      if (post.id === firstId) {
        await Promise.resolve();
        addWarning("Media analysis failed: Authorization: private-api-token");
        addWarning("Image analysis: model failed, used fallback (https://example.org/?key=private-api-token)");
        addWarning("Unexpected private-api-token diagnostic");
        throw new Error("Provider error");
      }
      return { reply: "Draft ready.", draft: note, research: "Evidence." };
    } });
    expect(await f.run([firstId, secondId])).toBe(1);
    const first = await readFile(join(f.outputDir, `${firstId}.json`), "utf8");
    expect(JSON.parse(first).warnings).toEqual([
      "Media analysis failed; research may be missing media context.",
      "Image analysis used a fallback model.",
      "The pipeline reported an additional warning; review the research and draft carefully.",
    ]);
    expect(first + f.output()).not.toContain("private-api-token");
    expect(f.output()).toContain("Warning: Media analysis failed;");
    expect(JSON.parse(await readFile(join(f.outputDir, `${secondId}.json`), "utf8")).warnings).toEqual([]);
  });
});

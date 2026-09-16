import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftingAdapter, DraftResult } from "../signal-bot/drafting";
import type { MaterialityScoreEntry, runMaterialityJudge } from "../pipeline/orchestration/materialityJudge";
import { MISINFO_TOPICS } from "../pipeline/misinfo-monitoring/topics";
import { getMonitoringContext } from "../pipeline/misinfo-monitoring/monitoringContext";
import { addWarning } from "../pipeline/utils/warnings";
import { getBotConfig, getBotConfigIfActive } from "../pipeline/ab-testing/botConfig";
import {
  parseReviewDraftBatchArgs, parseReviewDraftBatchInput, runReviewDraftBatch,
  type ReviewDraftBatchInput, type ReviewDraftBatchManifest, type ReviewDraftBatchResult,
} from "./reviewDraftBatch";

let directory: string;
const note = { text: "The original record gives a different date.", sources: ["https://example.org/record"] };
const topic = MISINFO_TOPICS[0]!;
const verdict: MaterialityScoreEntry[] = [{
  type: "materiality_overall", value: 0.75, label: "PASS", metadata: { why: "This changes the central claim." },
}];

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "review-draft-batch-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function input(id = "2099621874279817638", origin: "chat" | "topic" = "chat"): ReviewDraftBatchInput {
  return {
    post: { id, author_id: "42", text: "An original factual claim.", created_at: "2026-09-16T12:00:00Z", media: [] },
    origin, fetchedAt: "2026-09-16T13:00:00Z", ...(origin === "topic" ? { topicId: topic.id } : {}),
  };
}

function fixture(options: { draft?: DraftingAdapter["draft"]; judge?: typeof runMaterialityJudge } = {}) {
  const draft = mock(options.draft ?? (async (): Promise<DraftResult> => ({
    reply: "Proposed draft based on the research and source check.", draft: note, research: "Complete research with primary sources.",
  })));
  const judgeImplementation: typeof runMaterialityJudge = options.judge ?? (async () => verdict);
  const judge = mock(judgeImplementation);
  const inspect = mock(async () => { throw new Error("The batch must not fetch tweets."); });
  const submit = mock(async () => { throw new Error("The batch must not submit notes."); });
  const log = mock((_message: string) => {});
  const closeBrowser = mock(async () => {});
  const outputDir = join(directory, "results");
  const inputPath = join(directory, "input.json");
  const run = async (entries: unknown, flags: string[] = []) => {
    await writeFile(inputPath, JSON.stringify(entries));
    const adapter = { draft, inspect, submit };
    return runReviewDraftBatch(["--input", inputPath, "--output-dir", outputDir, ...flags], {
      adapter, judge, log, closeBrowser, now: () => new Date("2026-09-16T14:00:00Z"),
    });
  };
  return {
    draft, judge, inspect, submit, log, closeBrowser, outputDir, inputPath, run,
    output: () => log.mock.calls.map(([message]) => message).join("\n"),
    result: async (id: string): Promise<ReviewDraftBatchResult> => JSON.parse(await readFile(join(outputDir, `${id}.json`), "utf8")),
    manifest: async (): Promise<ReviewDraftBatchManifest> => JSON.parse(await readFile(join(outputDir, "results.json"), "utf8")),
  };
}

describe("review draft batches", () => {
  test("help requires no input, adapters, output directory, or browser initialization", async () => {
    const log = mock((_message: string) => {});
    const closeBrowser = mock(async () => {});
    expect(await runReviewDraftBatch(["--help"], { log, closeBrowser })).toBe(0);
    expect(log.mock.calls[0]![0]).toContain("not a probability");
    expect(closeBrowser).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  test("arguments require a manifest and enforce bounded work", () => {
    expect(parseReviewDraftBatchArgs(["--input", "posts.json"])).toMatchObject({ max: 20, concurrency: 3 });
    for (const args of [[], ["--unknown"], ["--input"], ["--input", "one", "--input", "two"],
      ["--input", "one", "--max", "101"], ["--input", "one", "--max", "0"],
      ["--input", "one", "--concurrency", "9"], ["--input", "one", "--concurrency", "1.5"]]) {
      expect(() => parseReviewDraftBatchArgs(args)).toThrow();
    }
  });

  test("validates origins, topic membership, complete post fields, and provenance dates", async () => {
    const original = input();
    for (const invalid of [null, [], [{ ...original, origin: "unknown" }],
      [{ ...original, origin: "topic" }], [{ ...original, topicId: "unknown" }],
      [{ ...original, fetchedAt: "invalid" }], [{ ...original, post: { ...original.post, id: "../../outside" } }],
      [{ ...original, post: { ...original.post, text: "  " } }], [{ ...original, post: { ...original.post, media: null } }]]) {
      expect(() => parseReviewDraftBatchInput(invalid)).toThrow();
    }
    const f = fixture();
    expect(await f.run([{ ...original, topicId: "unknown" }])).toBe(1);
    expect(f.draft).not.toHaveBeenCalled();
    expect(f.closeBrowser).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(["input.json"]);
  });

  test("saves full drafts, research, provenance, advisory scores and private ordered files", async () => {
    const f = fixture();
    const original = input();
    expect(await f.run([original])).toBe(0);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.draft.mock.calls[0]![0]).toEqual({
      post: original.post, history: [{ role: "user", content: `https://x.com/i/web/status/${original.post.id}` }],
    });
    const saved = await f.result(original.post.id);
    expect(saved.input).toEqual(original);
    expect(saved.provenance).toEqual([original]);
    expect(saved.status).toBe("draft");
    expect(saved.result?.draft).toEqual(note);
    expect(saved.result?.research).toBe("Complete research with primary sources.");
    expect(saved.noteText).toBe(`${note.text} ${note.sources[0]}`);
    expect(saved.characterCount).toBe(note.text.length + 2);
    expect(saved.screening).toEqual({ label: "uncalibrated screening score", scores: verdict, score: 0.75, reason: "This changes the central claim." });
    expect(f.judge.mock.calls[0]).toEqual([{
      postText: original.post.text, findings: "Complete research with primary sources.", noteText: `${note.text} ${note.sources[0]}`,
    }]);
    expect((await f.manifest()).results).toEqual([saved]);
    expect((await f.manifest()).status).toBe("complete");
    expect((await stat(f.outputDir)).mode & 0o777).toBe(0o700);
    for (const filename of await readdir(f.outputDir)) expect((await stat(join(f.outputDir, filename))).mode & 0o777).toBe(0o600);
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
  });

  test("rejects unsafe media inputs in every URL location before invoking the pipeline", async () => {
    const original = input();
    for (const url of ["/private/tmp/video.mp4", "./video.mp4", '../video-$(touch marker).mp4', "file:///etc/passwd",
      "data:image/png;base64,c2VjcmV0", "http://127.0.0.1/video", "http://192.168.1.2/video", "http://169.254.169.254/",
      "https://user:password@example.org/video", "https://example.org:9999/video", "https://host.internal/video"]) {
      const mediaCases = [
        [{ type: "photo", url }], [{ type: "video", preview_image_url: url }],
        [{ type: "video", variants: [{ content_type: "video/mp4", url }] }],
      ];
      for (const media of mediaCases) {
        expect(() => parseReviewDraftBatchInput([{ ...original, post: { ...original.post, media } }])).toThrow("public HTTP(S)");
        expect(() => parseReviewDraftBatchInput([{ ...original, post: {
          ...original.post, referenced_tweet_data: { ...original.post, id: "102", media },
        } }])).toThrow("public HTTP(S)");
      }
    }
    for (const media of [[null], [{ type: "video", variants: "invalid" }],
      [{ type: "video", variants: [null] }], [{ type: "photo", url: 123 }],
      [{ type: "video", url: "https://video.example.org/file.mp4", duration_ms: "1; touch marker" }]]) {
      expect(() => parseReviewDraftBatchInput([{ ...original, post: { ...original.post, media } }])).toThrow();
    }
    const f = fixture();
    expect(await f.run([{ ...original, post: { ...original.post, media: [{ type: "video", url: "/private/tmp/video.mp4" }] } }])).toBe(1);
    expect(f.draft).not.toHaveBeenCalled();
    expect(f.judge).not.toHaveBeenCalled();
    expect(f.closeBrowser).not.toHaveBeenCalled();
    expect(parseReviewDraftBatchInput([{ ...original, post: { ...original.post, media: [{
      type: "video", preview_image_url: "https://pbs.twimg.com/media/frame.jpg", duration_ms: 1000,
      variants: [{ content_type: "video/mp4", url: "https://video.twimg.com/media/video.mp4", bit_rate: 100000 }],
    }] } }])).toHaveLength(1);
  });

  test("deduplicates IDs before applying max and retains all provenance", async () => {
    const f = fixture();
    const original = input("101");
    const duplicate = input("101", "topic");
    expect(await f.run([original, duplicate, input("102"), input("103")], ["--max", "2"])).toBe(0);
    expect(f.draft).toHaveBeenCalledTimes(2);
    expect((await f.result("101")).provenance).toEqual([original, duplicate]);
    expect((await f.manifest()).results.map((result) => result.tweetId)).toEqual(["101", "102"]);
  });

  test("keeps topic reference context and warnings scoped to each concurrent tweet", async () => {
    const seen = new Map<string, string | undefined>();
    const f = fixture({ draft: async ({ post }) => {
      await new Promise((resolve) => setTimeout(resolve, post.id === "101" ? 15 : 1));
      const context = getMonitoringContext();
      seen.set(post.id, context?.topicId);
      if (post.id === "101") {
        expect(context?.document).toBe(topic.document);
        expect(context?.topicTitle).toBe(topic.title);
        addWarning("Media analysis failed: private-api-token");
      }
      return { reply: "Ready.", draft: note, research: "Research." };
    } });
    expect(await f.run([input("101", "topic"), input("102")])).toBe(0);
    expect(seen.get("101")).toBe(topic.id);
    expect(seen.get("102")).toBeUndefined();
    expect((await f.result("101")).warnings).toEqual(["Media analysis failed; research may be missing media context."]);
    expect((await f.result("102")).warnings).toEqual([]);
    expect(JSON.stringify(await f.manifest()) + f.output()).not.toContain("private-api-token");
    expect((await f.manifest()).results.map((result) => result.tweetId)).toEqual(["101", "102"]);
    expect(getMonitoringContext()).toBeUndefined();
  });

  test("screening failure preserves the complete draft and does not stop the batch", async () => {
    const f = fixture({ judge: async () => { throw new Error("Authorization: private-api-token"); } });
    expect(await f.run([input("101"), input("102")])).toBe(0);
    expect(f.draft).toHaveBeenCalledTimes(2);
    const saved = await f.result("101");
    expect(saved.status).toBe("draft");
    expect(saved.result?.draft).toEqual(note);
    expect(saved.screening?.error).toContain("advisory screening judge failed");
    expect(saved.screening?.score).toBeUndefined();
    expect(saved.warnings).toContain(saved.screening!.error!);
    expect(JSON.stringify(saved) + f.output()).not.toContain("private-api-token");
  });

  test("the judge receives the explicit Signal bot config after the drafting scope has exited", async () => {
    const f = fixture({ judge: async () => {
      expect(getBotConfig()).toMatchObject({
        botId: "simple-bot", author_history: false, web_search: "native", search_model: "anthropic/claude-sonnet-4.6",
      });
      return verdict;
    } });
    expect(getBotConfigIfActive()).toBeUndefined();
    expect(await f.run([input("101")])).toBe(0);
    expect((await f.result("101")).screening?.score).toBe(0.75);
    expect(getBotConfigIfActive()).toBeUndefined();
  });

  test("invalid judge scores are represented as unavailable, not fabricated estimates", async () => {
    const f = fixture({ judge: async () => [{ ...verdict[0]!, value: 7 }] });
    expect(await f.run([input("101")])).toBe(0);
    expect((await f.result("101")).screening?.score).toBeUndefined();
    expect((await f.result("101")).screening?.error).toBeDefined();
  });

  test("research failure is retained safely, continues later drafts, and returns nonzero", async () => {
    const f = fixture({ draft: async ({ post }) => {
      if (post.id === "101") {
        addWarning("Unexpected private-api-token diagnostic");
        throw new Error("Provider response with private-api-token");
      }
      return { reply: "Ready.", draft: note, research: "Research." };
    } });
    expect(await f.run([input("101"), input("102")])).toBe(1);
    expect((await f.result("101")).status).toBe("error");
    expect((await f.result("102")).status).toBe("draft");
    expect((await f.manifest()).completed).toBe(2);
    expect((await f.manifest()).status).toBe("error");
    expect(JSON.stringify(await f.manifest()) + f.output()).not.toContain("private-api-token");
    expect(f.closeBrowser).toHaveBeenCalledTimes(1);
  });

  test("supported abstention is successful and skips judging", async () => {
    const f = fixture({ draft: async () => ({ reply: "No correction.", abstentionReason: "The claim is supported.", research: "Evidence." }) });
    expect(await f.run([input("101")])).toBe(0);
    expect((await f.result("101")).status).toBe("no_draft");
    expect((await f.result("101")).result?.research).toBe("Evidence.");
    expect(f.judge).not.toHaveBeenCalled();
  });

  test("persists results while another draft is still running and limits concurrency", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maximum = 0;
    const f = fixture({ draft: async ({ post }) => {
      active++;
      maximum = Math.max(maximum, active);
      if (post.id === "102") await blocked;
      active--;
      return { reply: "Ready.", draft: note, research: "Research." };
    } });
    const running = f.run([input("101"), input("102"), input("103")], ["--concurrency", "2"]);
    try {
      let partial: ReviewDraftBatchManifest | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { partial = await f.manifest(); } catch { /* Wait for first atomic result save. */ }
        if (partial?.results.some((result) => result.tweetId === "101")) break;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(partial?.status).toBe("running");
      expect(partial?.results.some((result) => result.tweetId === "101")).toBe(true);
      expect(partial?.results.some((result) => result.tweetId === "102")).toBe(false);
    } finally { release(); }
    expect(await running).toBe(0);
    expect(maximum).toBeLessThanOrEqual(2);
    expect((await f.manifest()).results.map((result) => result.tweetId)).toEqual(["101", "102", "103"]);
  });

  test("preserves existing output and avoids paying for an unrunnable batch", async () => {
    const f = fixture();
    await mkdir(f.outputDir, { mode: 0o700 });
    await writeFile(join(f.outputDir, "101.json"), "existing result");
    expect(await f.run([input("101")])).toBe(1);
    expect(await readFile(join(f.outputDir, "101.json"), "utf8")).toBe("existing result");
    expect(f.draft).not.toHaveBeenCalled();
  });
});

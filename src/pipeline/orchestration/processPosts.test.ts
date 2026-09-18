import { describe, expect, mock, test } from "bun:test";
import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";

// The claim-check service is replaced by a table of canned outcomes keyed by post id.
const outcomes = new Map<string, "candidate" | "rejected">();
const started: string[] = [];
mock.module("../../service/client", () => ({
  requestTweetCheck: async ({ post }: { post: Post }) => {
    started.push(post.id);
    await new Promise((r) => setTimeout(r, 5));
    const outcome = outcomes.get(post.id) ?? "rejected";
    return { output: { outcome, outcomeReason: outcome === "rejected" ? "prefilter_no_note" : undefined, finalStage: outcome, flatLog: {}, scores: [], warnings: [], bot: { name: "simple-bot", picks: {}, config: {} } } };
  },
}));
const { processPosts } = await import("./generateCandidates");

function post(id: string): Post {
  return { id, text: `post ${id}`, author_id: "a", created_at: new Date().toISOString() } as unknown as Post;
}

function fakeLogger() {
  const inserted: string[] = [];
  const logger = {
    bulkInsertNewTweets: async (posts: Post[]) => { inserted.push(...posts.map((p) => p.id)); },
    createPipelineRun: async ({ tweet_id }: { tweet_id: string }) => `run-${tweet_id}`,
    completePipelineRun: async () => {},
    addPipelineScore: async () => {},
  } as unknown as SupabaseLogger;
  return { logger, inserted };
}

describe("processPosts early stop for a cooldown probe", () => {
  test("stops starting posts once one note is ready and leaves the rest untouched", async () => {
    started.length = 0; outcomes.clear(); outcomes.set("3", "candidate");
    const { logger, inserted } = fakeLogger();
    const items = ["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => ({ post: post(id), velocity: null }));
    const candidates = await processPosts(items as never, logger, { stopAfterCandidates: 1, concurrency: 1, insertTweetOnStart: true });
    expect(candidates.map((c) => c.post.id)).toEqual(["3"]);
    expect(started).toEqual(["1", "2", "3"]);
    // Only started posts get a tweets row, so 4 to 8 stay eligible for the next run.
    expect(inserted).toEqual(["1", "2", "3"]);
  });

  test("with a few posts in flight, the ones already started still finish", async () => {
    started.length = 0; outcomes.clear(); outcomes.set("1", "candidate");
    const { logger } = fakeLogger();
    const items = ["1", "2", "3", "4", "5", "6"].map((id) => ({ post: post(id), velocity: null }));
    const candidates = await processPosts(items as never, logger, { stopAfterCandidates: 1, concurrency: 3, insertTweetOnStart: true });
    expect(candidates.map((c) => c.post.id)).toEqual(["1"]);
    expect(started).toEqual(["1", "2", "3"]);
  });

  test("without the option every post runs, as before", async () => {
    started.length = 0; outcomes.clear(); outcomes.set("1", "candidate");
    const { logger, inserted } = fakeLogger();
    const items = ["1", "2", "3", "4"].map((id) => ({ post: post(id), velocity: null }));
    const candidates = await processPosts(items as never, logger, {});
    expect(candidates.map((c) => c.post.id)).toEqual(["1"]);
    expect(started.sort()).toEqual(["1", "2", "3", "4"]);
    expect(inserted).toEqual([]);
  });
});

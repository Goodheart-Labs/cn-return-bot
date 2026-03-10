import { describe, test, expect } from "bun:test";
import { rankCandidates, type CandidateForRanking } from "./candidateRanker";

function makeCandidate(overrides: Partial<CandidateForRanking> = {}): CandidateForRanking {
  return {
    pipelineRunId: "test-id-" + Math.random().toString(36).slice(2, 8),
    tweetId: "tweet-1",
    noteText: "Test note",
    sourceUrl: "https://example.com",
    botId: "test-bot",
    createdAt: new Date(),
    searchResults: "",
    tweetText: "Test tweet",
    scores: { evaluation: 1.0 },
    ...overrides,
  };
}

describe("rankCandidates", () => {
  test("returns empty array for empty input", () => {
    expect(rankCandidates([])).toEqual([]);
  });

  test("higher eval score ranks higher", () => {
    const high = makeCandidate({ scores: { evaluation: 2.0 }, tweetId: "a" });
    const low = makeCandidate({ scores: { evaluation: -1.0 }, tweetId: "b" });
    const ranked = rankCandidates([low, high]);
    expect(ranked[0].tweetId).toBe("a");
    expect(ranked[1].tweetId).toBe("b");
  });

  test("higher impressions rank higher when eval is equal", () => {
    const viral = makeCandidate({
      tweetId: "viral",
      scores: { evaluation: 1.0 },
      tweetImpressions: 10_000_000,
    });
    const quiet = makeCandidate({
      tweetId: "quiet",
      scores: { evaluation: 1.0 },
      tweetImpressions: 100_000,
    });
    const ranked = rankCandidates([quiet, viral]);
    expect(ranked[0].tweetId).toBe("viral");
    expect(ranked[1].tweetId).toBe("quiet");
  });

  test("impressions bonus is meaningful but doesn't dominate eval", () => {
    // A great eval on a small tweet should still beat a bad eval on a viral tweet
    const goodEvalSmall = makeCandidate({
      tweetId: "good-small",
      scores: { evaluation: 2.5 },
      tweetImpressions: 50_000,
    });
    const badEvalViral = makeCandidate({
      tweetId: "bad-viral",
      scores: { evaluation: -1.0 },
      tweetImpressions: 50_000_000,
    });
    const ranked = rankCandidates([badEvalViral, goodEvalSmall]);
    expect(ranked[0].tweetId).toBe("good-small");
  });

  test("older candidates are penalized", () => {
    const fresh = makeCandidate({
      tweetId: "fresh",
      createdAt: new Date(),
    });
    const stale = makeCandidate({
      tweetId: "stale",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h old
    });
    const ranked = rankCandidates([stale, fresh]);
    expect(ranked[0].tweetId).toBe("fresh");
  });

  test("candidates without eval get default low score", () => {
    const withEval = makeCandidate({
      tweetId: "with-eval",
      scores: { evaluation: 1.0 },
    });
    const noEval = makeCandidate({
      tweetId: "no-eval",
      scores: {},
    });
    const ranked = rankCandidates([noEval, withEval]);
    expect(ranked[0].tweetId).toBe("with-eval");
  });

  test("candidates without impressions get zero bonus", () => {
    const withImpressions = makeCandidate({
      tweetId: "with-imp",
      tweetImpressions: 5_000_000,
    });
    const noImpressions = makeCandidate({
      tweetId: "no-imp",
    });
    const ranked = rankCandidates([noImpressions, withImpressions]);
    expect(ranked[0].tweetId).toBe("with-imp");
  });

  test("all candidates get a rankScore property", () => {
    const candidates = [
      makeCandidate({ tweetId: "a" }),
      makeCandidate({ tweetId: "b" }),
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0].rankScore).toBeDefined();
    expect(typeof ranked[0].rankScore).toBe("number");
    expect(ranked[1].rankScore).toBeDefined();
  });
});

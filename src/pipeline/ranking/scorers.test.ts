import { describe, expect, test } from "bun:test";
import { featuresFromPost, featuresFromTweetRow, flagCount, flagsOf, type RankFeatures } from "./features";
import { flagsThenEval, getScorer, velocityOnly } from "./scorers";
import type { Post } from "../../api/fetchEligiblePosts";

const base: RankFeatures = { hasMedia: true, authorFollowers: 50_000, velocityPerHour: 40_000, ageHoursAtFetch: 6, tierRank: 1 };

describe("flags", () => {
  test("all four pass on a media post from a small account, fast and 3-12h old", () => {
    expect(flagCount(base)).toBe(4);
  });

  test("each flag fails at its boundary", () => {
    expect(flagsOf({ ...base, hasMedia: false }).media).toBe(false);
    expect(flagsOf({ ...base, authorFollowers: 1_000_000 }).smallAuthor).toBe(false);
    expect(flagsOf({ ...base, authorFollowers: 999_999 }).smallAuthor).toBe(true);
    expect(flagsOf({ ...base, velocityPerHour: 14_999 }).fast).toBe(false);
    expect(flagsOf({ ...base, velocityPerHour: 15_000 }).fast).toBe(true);
    expect(flagsOf({ ...base, ageHoursAtFetch: 2.9 }).freshWindow).toBe(false);
    expect(flagsOf({ ...base, ageHoursAtFetch: 12 }).freshWindow).toBe(false);
    expect(flagsOf({ ...base, ageHoursAtFetch: 3 }).freshWindow).toBe(true);
  });

  test("unknown values fail open", () => {
    expect(flagCount({ hasMedia: true, authorFollowers: null, velocityPerHour: null, ageHoursAtFetch: null, tierRank: null })).toBe(4);
  });
});

describe("featuresFromPost", () => {
  const now = Date.parse("2026-09-03T12:00:00Z");
  const post = {
    id: "1",
    author_id: "a",
    created_at: "2026-09-03T06:00:00Z",
    text: "",
    media: [{ type: "photo" }],
    public_metrics: { impression_count: 120_000 },
    author_followers: 20_000,
  } as unknown as Post;

  test("derives age and velocity from the post when no frozen velocity is given", () => {
    const f = featuresFromPost(post, undefined, 0, now);
    expect(f.ageHoursAtFetch).toBe(6);
    expect(f.velocityPerHour).toBe(20_000);
    expect(f.hasMedia).toBe(true);
    expect(f.tierRank).toBe(0);
  });

  test("prefers the frozen velocity", () => {
    expect(featuresFromPost(post, 55_000, 0, now).velocityPerHour).toBe(55_000);
  });

  test("tweet rows and posts give the same features", () => {
    const fromRow = featuresFromTweetRow({
      posted_at: "2026-09-03T06:00:00Z",
      first_seen_at: "2026-09-03T12:00:00Z",
      impressions: 120_000,
      author_followers: 20_000,
      has_video: false,
      has_photo: true,
    });
    const fromPost = featuresFromPost(post, undefined, null, now);
    expect(fromRow).toEqual(fromPost);
  });
});

describe("scorers", () => {
  test("flags_then_eval ranks by flag count before anything else", () => {
    const threeFlagsFast = { ...base, hasMedia: false, velocityPerHour: 900_000 };
    expect(flagsThenEval.scoreAdmission(base)).toBeGreaterThan(flagsThenEval.scoreAdmission(threeFlagsFast));
    expect(flagsThenEval.scoreSubmit(base, -2)).toBeGreaterThan(flagsThenEval.scoreSubmit(threeFlagsFast, 3));
  });

  test("flags_then_eval uses eval within a flag band", () => {
    expect(flagsThenEval.scoreSubmit(base, 1.5)).toBeGreaterThan(flagsThenEval.scoreSubmit(base, -0.5));
  });

  test("velocity_only reproduces tier then velocity", () => {
    const smallSlow = { ...base, tierRank: 0, velocityPerHour: 6_000 };
    const largeFast = { ...base, tierRank: 1, velocityPerHour: 400_000 };
    expect(velocityOnly.scoreAdmission(smallSlow)).toBeGreaterThan(velocityOnly.scoreAdmission(largeFast));
  });

  test("unknown scorer names throw", () => {
    expect(() => getScorer("nope")).toThrow();
  });
});

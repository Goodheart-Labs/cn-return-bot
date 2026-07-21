import { test, expect } from "bun:test";
import { fillWithTopicPriority, TOPIC_PRIORITY_SLOTS } from "./regularFeedTopicCuration";
import { velocityPerHour } from "../utils/velocity";
import type { Post } from "../../api/fetchEligiblePosts";
import type { FeedSize } from "../orchestration/utils/feedSizeStrategy";

const HOUR_MS = 3_600_000;

// Fixtures carry velocity frozen at construction, mirroring the fetch-time
// freeze in collectFastPosts.
function sourced(id: string, impressions: number | undefined, ageHours: number, feedSize: FeedSize = "large") {
  const post: Post = {
    id,
    author_id: "a1",
    created_at: new Date(Date.now() - ageHours * HOUR_MS).toISOString(),
    text: "",
    media: [],
    public_metrics: impressions === undefined ? undefined : { impression_count: impressions },
  };
  return { post, feedSize, velocity: velocityPerHour(post) };
}

// Extreme velocities so the tests survive any sane retuning elsewhere.
const fast = (id: string) => sourced(id, 10_000_000, 1); // ~10M/h
const slow = (id: string) => sourced(id, 100, 40);       // ~2/h

test("no confirmed matches → selection unchanged", () => {
  const selected = [fast("r1"), fast("r2")];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(), [...selected, slow("t1")], 2);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
  expect(displacedCount).toBe(0);
});

test("slots = 0 disables prioritization entirely", () => {
  const selected = [fast("r1")];
  const pool = [...selected, slow("t1")];
  const { final, prioritized } = fillWithTopicPriority(selected, new Set(["t1"]), pool, 1, 0);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
});

test("confirmed posts from the pool win slots, displacing the slowest regulars", () => {
  const selected = [fast("r1"), fast("r2"), fast("r3")];
  const pool = [...selected, slow("t1")];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(["t1"]), pool, 3);
  expect(final.map((s) => s.post.id)).toContain("t1");
  expect(final).toHaveLength(3);
  expect(prioritized.map((s) => s.post.id)).toEqual(["t1"]);
  expect(displacedCount).toBe(1); // r3 (last of the velocity-ranked regulars) dropped
  expect(final.map((s) => s.post.id)).not.toContain("r3");
});

test("cap: only the fastest confirmed posts take slots", () => {
  const selected = [fast("r1"), fast("r2"), fast("r3"), fast("r4")];
  const confirmed = new Set(["t1", "t2", "t3", "t4"]);
  const pool = [...selected, sourced("t1", 4_000_000, 1), sourced("t2", 3_000_000, 1), sourced("t3", 2_000_000, 1), sourced("t4", 1_000_000, 1)];
  const { final, prioritized } = fillWithTopicPriority(selected, confirmed, pool, 4);
  expect(prioritized).toHaveLength(TOPIC_PRIORITY_SLOTS);
  // Fastest 3 of the 4 confirmed win; t4 (slowest confirmed) does not.
  expect(prioritized.map((s) => s.post.id).sort()).toEqual(["t1", "t2", "t3"]);
  expect(final.map((s) => s.post.id)).not.toContain("t4");
});

test("confirmed posts already selected count toward the slot cap (no double budget)", () => {
  const t1 = fast("t1"); // confirmed AND fast enough to be regularly selected
  const selected = [t1, fast("r1"), fast("r2")];
  const pool = [...selected, slow("t2"), slow("t3"), slow("t4")];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(["t1", "t2", "t3", "t4"]), pool, 3);
  expect(prioritized).toHaveLength(3);
  expect(prioritized.map((s) => s.post.id)).toContain("t1"); // occupies a priority slot
  expect(final).toHaveLength(3);
  // t1 + two slow confirmed take all 3 slots; both regulars displaced.
  expect(displacedCount).toBe(2);
});

test("maxPosts below the slot count → final never exceeds the budget", () => {
  // Near writing-limit exhaustion computeMaxPosts produces maxPosts of 1-2.
  const selected = [fast("r1")];
  const pool = [...selected, sourced("t1", 4_000_000, 1), sourced("t2", 3_000_000, 1), sourced("t3", 2_000_000, 1)];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(["t1", "t2", "t3"]), pool, 1);
  expect(final).toHaveLength(1);
  expect(final.map((s) => s.post.id)).toEqual(["t1"]); // fastest confirmed takes the only slot
  expect(prioritized).toHaveLength(1);
  expect(displacedCount).toBe(1); // r1
});

test("budget not full → no displacement", () => {
  const selected = [fast("r1")];
  const pool = [...selected, slow("t1")];
  const { final, displacedCount } = fillWithTopicPriority(selected, new Set(["t1"]), pool, 5);
  expect(final).toHaveLength(2);
  expect(displacedCount).toBe(0);
});

test("output is velocity-sorted descending (unknown velocity last)", () => {
  const selected = [fast("r1")];
  const noMetrics = sourced("t1", undefined, 1); // unknown velocity
  const pool = [...selected, noMetrics, sourced("t2", 5_000_000, 1)];
  const { final } = fillWithTopicPriority(selected, new Set(["t1", "t2"]), pool, 3);
  expect(final.map((s) => s.post.id)).toEqual(["r1", "t2", "t1"]);
});

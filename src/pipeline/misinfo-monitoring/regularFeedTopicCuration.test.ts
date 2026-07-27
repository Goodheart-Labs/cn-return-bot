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
// `mid` is confirmed-topic territory: far above any sane topic floor, far
// below `fast` — for tests about slower-than-regular confirmed posts winning
// slots. `slow` is below any sane topic floor.
const fast = (id: string) => sourced(id, 10_000_000, 1); // ~10M/h
const mid = (id: string) => sourced(id, 100_000, 1);     // ~100K/h
const slow = (id: string) => sourced(id, 100, 40);       // ~2/h

test("no confirmed matches → selection unchanged", () => {
  const selected = [fast("r1"), fast("r2")];
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(selected, new Set(), [...selected, mid("t1")], 2);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
  expect(displacedCount).toBe(0);
  expect(floorDropped).toHaveLength(0);
});

test("slots = 0 disables prioritization entirely", () => {
  const selected = [fast("r1")];
  const pool = [...selected, mid("t1")];
  const { final, prioritized, floorDropped } = fillWithTopicPriority(selected, new Set(["t1"]), pool, 1, 0);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
  expect(floorDropped).toHaveLength(0);
});

test("confirmed posts from the pool win slots, displacing the slowest regulars", () => {
  const selected = [fast("r1"), fast("r2"), fast("r3")];
  const pool = [...selected, mid("t1")];
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
  const pool = [...selected, mid("t2"), mid("t3"), mid("t4")];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(["t1", "t2", "t3", "t4"]), pool, 3);
  expect(prioritized).toHaveLength(3);
  expect(prioritized.map((s) => s.post.id)).toContain("t1"); // occupies a priority slot
  expect(final).toHaveLength(3);
  // t1 + two mid confirmed take all 3 slots; both regulars displaced.
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
  const pool = [...selected, mid("t1")];
  const { final, displacedCount } = fillWithTopicPriority(selected, new Set(["t1"]), pool, 5);
  expect(final).toHaveLength(2);
  expect(displacedCount).toBe(0);
});

test("output is the prioritized confirmed posts, then the kept regulars", () => {
  const selected = [fast("r1")];
  const noMetrics = sourced("t1", undefined, 1); // unknown velocity
  const pool = [...selected, noMetrics, sourced("t2", 5_000_000, 1)];
  const { final } = fillWithTopicPriority(selected, new Set(["t1", "t2"]), pool, 3);
  // Prioritized first (t2 fast, t1 unknown-velocity last), then the regular r1.
  // NOT globally velocity-sorted: this list is the processing/submission order,
  // and regulars keep the ranking selection already gave them.
  expect(final.map((s) => s.post.id)).toEqual(["t2", "t1", "r1"]);
});

// ── Topic velocity floor (the 7/21 pre-pass/curation loophole) ──────────────

test("incident shape: a below-floor confirmed post is floor-dropped, not prioritized", () => {
  // The 7/21 incident: the pre-pass floor dropped an 11/h post, then curation
  // re-injected it via stored-verdict reuse and displaced a regular pick.
  const selected = [fast("r1"), fast("r2"), fast("r3")];
  const incident = sourced("t1", 55, 5); // ~11/h — below any sane topic floor
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(
    selected, new Set(["t1"]), [...selected, incident], 3,
  );
  expect(final).toEqual(selected); // identical selection — displacement was the damage
  expect(prioritized).toHaveLength(0);
  expect(displacedCount).toBe(0);
  expect(floorDropped.map((s) => s.post.id)).toEqual(["t1"]); // the call-site log depends on this
});

test("mixed confirmed posts: slots go only to the above-floor ones", () => {
  const selected = [fast("r1"), fast("r2"), fast("r3")];
  const pool = [...selected, mid("t1"), slow("t2")];
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(
    selected, new Set(["t1", "t2"]), pool, 3,
  );
  expect(prioritized.map((s) => s.post.id)).toEqual(["t1"]);
  expect(floorDropped.map((s) => s.post.id)).toEqual(["t2"]);
  expect(final.map((s) => s.post.id)).not.toContain("t2");
  expect(displacedCount).toBe(1); // only t1 displaces
});

test("unknown velocity passes the floor (fail-open) but sorts behind a known-fast post for scarce slots", () => {
  // Fail-open must not become fail-first: null clears the floor yet ranks last.
  const selected = [fast("r1")];
  const noMetrics = sourced("t1", undefined, 1); // unknown velocity
  const pool = [...selected, noMetrics, mid("t2")];
  const { prioritized, floorDropped } = fillWithTopicPriority(
    selected, new Set(["t1", "t2"]), pool, 3, 1,
  );
  expect(prioritized.map((s) => s.post.id)).toEqual(["t2"]); // the one slot goes to the known-fast post
  expect(floorDropped).toHaveLength(0); // null was NOT floor-dropped
});

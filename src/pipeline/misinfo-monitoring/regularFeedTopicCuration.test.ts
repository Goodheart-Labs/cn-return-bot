import { test, expect } from "bun:test";
import { fillWithTopicPriority, TOPIC_PRIORITY_SLOTS } from "./regularFeedTopicCuration";
import { velocityPerHour } from "../utils/velocity";
import type { Post } from "../../api/fetchEligiblePosts";
import type { FeedSize } from "../orchestration/utils/feedSizeStrategy";

const HOUR_MS = 3_600_000;

// Post ids name what the post IS in the test — "topic-*" for a curated-topic
// (e.g. Trump) post, "regular-*" for an ordinary feed pick — so the assertions
// read as statements about behaviour rather than about labels.
function sourced(id: string, impressions: number | undefined, ageHours: number, feedSize: FeedSize = "large") {
  const post: Post = {
    id,
    author_id: "a1",
    created_at: new Date(Date.now() - ageHours * HOUR_MS).toISOString(),
    text: "",
    media: [],
    public_metrics: impressions === undefined ? undefined : { impression_count: impressions },
  };
  // Velocity is frozen at construction, mirroring the fetch-time freeze in
  // collectFastPosts.
  return { post, feedSize, velocity: velocityPerHour(post) };
}

// Extreme velocities so the tests survive any sane retuning elsewhere.
// `mid` is confirmed-topic territory: far above any sane topic floor, far
// below `fast` — for tests about slower-than-regular confirmed posts winning
// slots. `slow` is below any sane topic floor.
const fast = (id: string) => sourced(id, 10_000_000, 1); // ~10M/h
const mid = (id: string) => sourced(id, 100_000, 1);     // ~100K/h
const slow = (id: string) => sourced(id, 100, 40);       // ~2/h

const ids = (posts: { post: Post }[]) => posts.map((s) => s.post.id);

test("no confirmed matches → selection unchanged", () => {
  const selected = [fast("regular-1"), fast("regular-2")];
  const pool = [...selected, mid("topic-unconfirmed")];
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(selected, new Set(), pool, 2);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
  expect(displacedCount).toBe(0);
  expect(floorDropped).toHaveLength(0);
});

test("slots = 0 disables prioritization entirely", () => {
  const selected = [fast("regular")];
  const pool = [...selected, mid("topic")];
  const { final, prioritized, floorDropped } = fillWithTopicPriority(selected, new Set(["topic"]), pool, 1, 0);
  expect(final).toEqual(selected);
  expect(prioritized).toHaveLength(0);
  expect(floorDropped).toHaveLength(0);
});

test("confirmed posts from the pool win slots, displacing the lowest-ranked regulars", () => {
  const selected = [fast("regular-1"), fast("regular-2"), fast("regular-last")];
  const pool = [...selected, mid("topic")];
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, new Set(["topic"]), pool, 3);
  expect(ids(final)).toContain("topic");
  expect(final).toHaveLength(3);
  expect(ids(prioritized)).toEqual(["topic"]);
  expect(displacedCount).toBe(1);
  expect(ids(final)).not.toContain("regular-last"); // last of the ranked regulars
});

test("cap: only the fastest confirmed posts take slots", () => {
  const selected = [fast("regular-1"), fast("regular-2"), fast("regular-3"), fast("regular-4")];
  const pool = [
    ...selected,
    sourced("topic-fastest", 4_000_000, 1),
    sourced("topic-2nd-fastest", 3_000_000, 1),
    sourced("topic-3rd-fastest", 2_000_000, 1),
    sourced("topic-slowest", 1_000_000, 1),
  ];
  const confirmed = new Set(["topic-fastest", "topic-2nd-fastest", "topic-3rd-fastest", "topic-slowest"]);
  const { final, prioritized } = fillWithTopicPriority(selected, confirmed, pool, 4);
  expect(prioritized).toHaveLength(TOPIC_PRIORITY_SLOTS);
  // Fastest 3 of the 4 confirmed win (velocity order); the slowest does not.
  expect(ids(prioritized)).toEqual(["topic-fastest", "topic-2nd-fastest", "topic-3rd-fastest"]);
  expect(ids(final)).not.toContain("topic-slowest");
});

test("confirmed posts already selected count toward the slot cap (no double budget)", () => {
  // Confirmed AND fast enough to have been picked by the regular selection.
  const alreadySelected = fast("topic-already-selected");
  const selected = [alreadySelected, fast("regular-1"), fast("regular-2")];
  const pool = [...selected, mid("topic-pool-1"), mid("topic-pool-2"), mid("topic-pool-3")];
  const confirmed = new Set(["topic-already-selected", "topic-pool-1", "topic-pool-2", "topic-pool-3"]);
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, confirmed, pool, 3);
  expect(prioritized).toHaveLength(3);
  expect(ids(prioritized)).toContain("topic-already-selected"); // occupies a slot, not a bonus
  expect(final).toHaveLength(3);
  // The already-selected topic post + two from the pool fill all 3 slots, so
  // both regulars are displaced.
  expect(displacedCount).toBe(2);
});

test("maxPosts below the slot count → final never exceeds the budget", () => {
  // Near writing-limit exhaustion computeMaxPosts produces maxPosts of 1-2.
  const selected = [fast("regular")];
  const pool = [
    ...selected,
    sourced("topic-fastest", 4_000_000, 1),
    sourced("topic-2nd-fastest", 3_000_000, 1),
    sourced("topic-3rd-fastest", 2_000_000, 1),
  ];
  const confirmed = new Set(["topic-fastest", "topic-2nd-fastest", "topic-3rd-fastest"]);
  const { final, prioritized, displacedCount } = fillWithTopicPriority(selected, confirmed, pool, 1);
  expect(final).toHaveLength(1);
  expect(ids(final)).toEqual(["topic-fastest"]); // fastest confirmed takes the only slot
  expect(prioritized).toHaveLength(1);
  expect(displacedCount).toBe(1); // the regular it took the slot from
});

test("budget not full → no displacement", () => {
  const selected = [fast("regular")];
  const pool = [...selected, mid("topic")];
  const { final, displacedCount } = fillWithTopicPriority(selected, new Set(["topic"]), pool, 5);
  expect(final).toHaveLength(2);
  expect(displacedCount).toBe(0);
});

test("output is the prioritized confirmed posts, then the kept regulars", () => {
  const selected = [fast("regular")];
  const pool = [...selected, sourced("topic-unknown-velocity", undefined, 1), sourced("topic-fast", 5_000_000, 1)];
  const confirmed = new Set(["topic-unknown-velocity", "topic-fast"]);
  const { final } = fillWithTopicPriority(selected, confirmed, pool, 3);
  // Prioritized first (fast one, then unknown-velocity last), then the regular.
  // NOT globally velocity-sorted: this list is the processing/submission order,
  // and regulars keep the ranking selection already gave them.
  expect(ids(final)).toEqual(["topic-fast", "topic-unknown-velocity", "regular"]);
});

// ── Topic velocity floor (the 7/21 pre-pass/curation loophole) ──────────────

test("incident shape: a below-floor confirmed post is floor-dropped, not prioritized", () => {
  // The 7/21 incident: the pre-pass floor dropped an 11/h post, then curation
  // re-injected it via stored-verdict reuse and displaced a regular pick.
  const selected = [fast("regular-1"), fast("regular-2"), fast("regular-3")];
  const incident = sourced("topic-below-floor", 55, 5); // ~11/h — below any sane topic floor
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(
    selected, new Set(["topic-below-floor"]), [...selected, incident], 3,
  );
  expect(final).toEqual(selected); // identical selection — displacement was the damage
  expect(prioritized).toHaveLength(0);
  expect(displacedCount).toBe(0);
  expect(ids(floorDropped)).toEqual(["topic-below-floor"]); // the call-site log depends on this
});

test("mixed confirmed posts: slots go only to the above-floor ones", () => {
  const selected = [fast("regular-1"), fast("regular-2"), fast("regular-3")];
  const pool = [...selected, mid("topic-above-floor"), slow("topic-below-floor")];
  const confirmed = new Set(["topic-above-floor", "topic-below-floor"]);
  const { final, prioritized, displacedCount, floorDropped } = fillWithTopicPriority(selected, confirmed, pool, 3);
  expect(ids(prioritized)).toEqual(["topic-above-floor"]);
  expect(ids(floorDropped)).toEqual(["topic-below-floor"]);
  expect(ids(final)).not.toContain("topic-below-floor");
  expect(displacedCount).toBe(1); // only the above-floor post displaces a regular
});

test("unknown velocity passes the floor (fail-open) but sorts behind a known-fast post for scarce slots", () => {
  // Fail-open must not become fail-first: null clears the floor yet ranks last.
  const selected = [fast("regular")];
  const pool = [...selected, sourced("topic-unknown-velocity", undefined, 1), mid("topic-known-fast")];
  const confirmed = new Set(["topic-unknown-velocity", "topic-known-fast"]);
  const { prioritized, floorDropped } = fillWithTopicPriority(selected, confirmed, pool, 3, 1);
  expect(ids(prioritized)).toEqual(["topic-known-fast"]); // the one slot goes to the known-fast post
  expect(floorDropped).toHaveLength(0); // null was NOT floor-dropped
});

// Shared A/B test filter primitives used by both stats-dashboard and
// review-dashboard. Keeping the matching logic, slot derivation, and the
// `ABFilters` shape in one place lets the two dashboards stay consistent.

export type ABFilters = Record<string, string | undefined>;

export interface ABTestSlotInfo {
  name: string;
  variants: string[];
  // True when some pick within the recency window differed from the test's
  // default — i.e. the test was actively varied lately. Dashboards show these
  // by default and hide the rest behind a "show older tests" toggle.
  recentlyVaried: boolean;
}

// A pick record paired with when it was produced, so slot derivation can tell
// which tests were varied recently. `at` is an ISO timestamp; records without
// one never count toward recency.
export interface AbPickRecord {
  picks: Record<string, string> | null | undefined;
  at?: string | null;
}

// Duck-typed AB_TESTS shape so the dashboards don't import pipeline-side types.
interface AbTestLike {
  name: string;
  defaultVariant?: string;
  variants: readonly { variant: { name: string }; weight: number }[];
}

const RECENT_NON_DEFAULT_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns true iff every set filter slot matches the corresponding entry in
 * `picks`. Unset filter slots are ignored. Works for any record that carries
 * an `ab_test_picks` dict — notes, aggregates, day buckets, review items.
 */
export function matchesAbFilters(
  picks: Record<string, string> | null | undefined,
  filters: ABFilters,
): boolean {
  for (const [slot, variant] of Object.entries(filters)) {
    if (!variant) continue;
    if (picks?.[slot] !== variant) return false;
  }
  return true;
}

/**
 * The variant a test sits at when it isn't being actively varied: its declared
 * defaultVariant, or — for prereq-gated tests that declare none — the
 * highest-weight arm (the de-facto control).
 */
function defaultVariantByTest(tests: readonly AbTestLike[]): Map<string, string> {
  return new Map(
    tests.map((t) => [
      t.name,
      t.defaultVariant ??
        t.variants.reduce((top, v) => (v.weight > top.weight ? v : top)).variant.name,
    ]),
  );
}

/**
 * Derive the slots-and-variants list for the filter UI from a stream of
 * observed pick records. Slots and variants are ordered to match the AB_TESTS
 * declaration; any that exist in historical picks but no longer in AB_TESTS are
 * appended alphabetically. Each slot is flagged `recentlyVaried` when some
 * record within the trailing window picked a non-default arm.
 */
export function buildAbTestSlots(
  records: Iterable<AbPickRecord>,
  tests: readonly AbTestLike[],
  windowDays: number = RECENT_NON_DEFAULT_WINDOW_DAYS,
): ABTestSlotInfo[] {
  const slotIndex = new Map(tests.map((t, i) => [t.name, i]));
  const variantIndexBySlot = new Map(
    tests.map((t) => [t.name, new Map(t.variants.map((v, i) => [v.variant.name, i]))]),
  );
  const defaults = defaultVariantByTest(tests);
  const cutoff = Date.now() - windowDays * MS_PER_DAY;

  const variantsBySlot = new Map<string, Set<string>>();
  const recentlyVaried = new Set<string>();
  for (const { picks, at } of records) {
    if (!picks) continue;
    const recent = !!at && new Date(at).getTime() >= cutoff;
    for (const [slot, variant] of Object.entries(picks)) {
      if (!variantsBySlot.has(slot)) variantsBySlot.set(slot, new Set());
      variantsBySlot.get(slot)!.add(variant);
      if (recent && variant !== defaults.get(slot)) recentlyVaried.add(slot);
    }
  }
  return [...variantsBySlot.entries()]
    .map(([name, variants]) => {
      const variantIndex = variantIndexBySlot.get(name) ?? new Map<string, number>();
      const ordered = [...variants].sort((a, b) => compareByMaybeIndex(a, b, variantIndex));
      return { name, variants: ordered, recentlyVaried: recentlyVaried.has(name) };
    })
    .sort((a, b) => compareByMaybeIndex(a.name, b.name, slotIndex));
}

function compareByMaybeIndex(a: string, b: string, index: Map<string, number>): number {
  const ai = index.get(a);
  const bi = index.get(b);
  if (ai != null && bi != null) return ai - bi;
  if (ai != null) return -1;
  if (bi != null) return 1;
  return a.localeCompare(b);
}

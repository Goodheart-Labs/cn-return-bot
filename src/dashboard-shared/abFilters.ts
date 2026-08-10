// Shared A/B test filter helpers, used by both the stats dashboard and the
// review dashboard. The matching logic, the slot derivation, and the `ABFilters`
// shape all live here, so the two dashboards cannot drift apart.

export type ABFilters = Record<string, string | undefined>;

export interface ABTestSlotInfo {
  name: string;
  variants: string[];
  // True when at least one pick inside the recency window used something other
  // than the test's default variant. That means the test was being varied
  // lately. The dashboards show those tests by default and hide the rest behind
  // a "show older tests" toggle.
  recentlyVaried: boolean;
}

// One set of A/B picks together with the time it was produced. The slot
// derivation needs that time to tell which tests were varied recently. `at` is
// an ISO timestamp. A record without one never counts towards recency.
export interface AbPickRecord {
  picks: Record<string, string> | null | undefined;
  at?: string | null;
}

// The part of the AB_TESTS shape we actually read. It is declared here so the
// dashboards never have to import a pipeline-side type.
interface AbTestLike {
  name: string;
  defaultVariant?: string;
  variants: readonly { variant: { name: string }; weight: number }[];
}

const RECENT_NON_DEFAULT_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns true when every filter slot that is set matches the matching entry in
 * `picks`. Filter slots that are not set are ignored. This works for any record
 * that carries an `ab_test_picks` dictionary, such as a note, an aggregate, a
 * day bucket, or a review item.
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
 * Works out the variant a test sits at when nobody is varying it. That is the
 * test's declared `defaultVariant`. Some tests are gated on a prerequisite and
 * declare no default. For those we take the arm with the highest weight, which
 * is the control in practice.
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
 * Builds the list of slots and variants the filter UI offers, out of a stream of
 * observed pick records. Slots and variants come out in the order AB_TESTS
 * declares them. Anything that appears in old picks but no longer in AB_TESTS is
 * appended at the end in alphabetical order. A slot is marked `recentlyVaried`
 * when some record inside the trailing window picked a non-default arm.
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

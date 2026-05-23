// Shared A/B test filter primitives used by both stats-dashboard and
// review-dashboard. Keeping the matching logic, slot derivation, and the
// `ABFilters` shape in one place lets the two dashboards stay consistent.

export type ABFilters = Record<string, string | undefined>;

export interface ABTestSlotInfo {
  name: string;
  variants: string[];
}

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
 * Derive the slots-and-variants list to display in the filter UI from a
 * stream of observed `ab_test_picks` dicts. Optional ordering hints let
 * callers with access to AB_TESTS metadata (server-side build) match the
 * declaration order; browser callers can omit them and fall back to
 * alphabetical.
 */
export function buildAbTestSlots(
  pickRecords: Iterable<Record<string, string> | null | undefined>,
  slotOrder: readonly string[] = [],
  variantOrder: Readonly<Record<string, readonly string[]>> = {},
): ABTestSlotInfo[] {
  const variantsBySlot = new Map<string, Set<string>>();
  for (const picks of pickRecords) {
    if (!picks) continue;
    for (const [slot, variant] of Object.entries(picks)) {
      if (!variantsBySlot.has(slot)) variantsBySlot.set(slot, new Set());
      variantsBySlot.get(slot)!.add(variant);
    }
  }
  const slotIndex = new Map(slotOrder.map((n, i) => [n, i]));
  const variantIndexBySlot = new Map(
    Object.entries(variantOrder).map(
      ([slot, vs]) => [slot, new Map(vs.map((v, i) => [v, i]))],
    ),
  );
  return [...variantsBySlot.entries()]
    .map(([name, variants]) => {
      const variantIndex = variantIndexBySlot.get(name) ?? new Map<string, number>();
      const ordered = [...variants].sort((a, b) => compareByMaybeIndex(a, b, variantIndex));
      return { name, variants: ordered };
    })
    .sort((a, b) => compareByMaybeIndex(a.name, b.name, slotIndex));
}

/**
 * Pull slot-order and variant-order arrays out of an AB_TESTS-shaped list,
 * for callers that have access to the declaration order and want to thread
 * it into `buildAbTestSlots`. Duck-typed so the dashboards don't need to
 * import any pipeline-side types.
 */
export function abTestOrdering(
  tests: readonly { name: string; variants: readonly { variant: { name: string } }[] }[],
): { slotOrder: string[]; variantOrder: Record<string, string[]> } {
  return {
    slotOrder: tests.map((t) => t.name),
    variantOrder: Object.fromEntries(
      tests.map((t) => [t.name, t.variants.map((v) => v.variant.name)]),
    ),
  };
}

function compareByMaybeIndex(a: string, b: string, index: Map<string, number>): number {
  const ai = index.get(a);
  const bi = index.get(b);
  if (ai != null && bi != null) return ai - bi;
  if (ai != null) return -1;
  if (bi != null) return 1;
  return a.localeCompare(b);
}

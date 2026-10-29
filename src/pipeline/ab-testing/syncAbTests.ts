import { getSupabaseClient } from "../../api/supabaseClient";
import { AB_TESTS, type ABTest } from "./abTestsData";

/** The arm a test sits at when nobody varies it: its declared default, or else
 *  the arm with the highest weight. A test gated on a prerequisite declares no
 *  default, and its control arm carries the highest weight in practice. */
export function controlVariant(test: ABTest): string {
  return test.defaultVariant ?? test.variants.reduce((top, v) => (v.weight > top.weight ? v : top)).variant.name;
}

/** The tests as the database's x_ab_tests table holds them, in AB_TESTS order. */
export function abTestRows(tests: readonly ABTest[] = AB_TESTS) {
  return tests.map((test) => ({
    test: test.name,
    fill_variant: test.defaultVariant ?? null,
    control_variant: controlVariant(test),
    variants: test.variants.map((v) => v.variant.name),
  }));
}

/** Writes the current A/B tests to the database, where the X notewriter page
 *  reads them (migration 159). Runs from before a test existed count as its
 *  default arm, and the page needs the defaults to know that. The database
 *  writes only the rows that changed. */
export async function syncAbTests(): Promise<void> {
  const { error } = await getSupabaseClient().rpc("x_sync_ab_tests", { p_tests: abTestRows() });
  if (error) throw new Error(`Writing the A/B tests failed: ${error.message}`);
}

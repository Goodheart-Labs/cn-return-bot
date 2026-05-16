/**
 * TS smoke test for reverseImageSearch.ts — bypasses A/B test wiring and
 * just exercises the public function on the HIR6DJ0W4AACPXK test image.
 *
 * Run:
 *   bun run src/scripts_jim/2026_05_15_reverse_image_search/smoke_ts.ts
 */

import {
  reverseSearchAndScore,
  formatReverseSearchContextForImage,
} from "../../pipeline/media/reverseImageSearch";

const TEST_URL = "https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg";

async function main(): Promise<void> {
  console.log(`[smoke_ts] querying: ${TEST_URL}`);
  const t0 = Date.now();
  const result = await reverseSearchAndScore({ kind: "url", url: TEST_URL, topN: 5 });
  const elapsed = Date.now() - t0;
  console.log(`[smoke_ts] took ${elapsed}ms\n`);

  if (!result) {
    console.error("[smoke_ts] reverseSearchAndScore returned null");
    process.exit(1);
  }
  console.log("--- formatted prompt context ---");
  console.log(formatReverseSearchContextForImage(result));
  console.log("\n--- raw result ---");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

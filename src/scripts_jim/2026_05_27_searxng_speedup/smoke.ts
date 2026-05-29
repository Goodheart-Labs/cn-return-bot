/**
 * Smoke test: hit the new fetchSearxngResults directly.
 *
 * Validates:
 *   - The new searxng.ts compiles and runs end-to-end.
 *   - Multiple concurrent calls don't deadlock on a missing queue.
 *   - When google returns 0 (currently the case from our IP), we get [] back
 *     fast without waiting 185s.
 *   - The shared engineSuspendedUntil short-circuits subsequent calls within
 *     a known cool-down window.
 */

import { fetchSearxngResults } from "../../pipeline/tool-calling/searxng";

async function main() {
  console.log("Firing 10 concurrent fetchSearxngResults calls...");
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      fetchSearxngResults(`smoke test ${i} climate news`).then((r) => ({ i, count: r.length, sample: r[0]?.url }))
    )
  );
  const wall = Date.now() - start;
  console.log(`Wall: ${wall}ms`);
  for (const r of results) console.log(`  [q${r.i}] results=${r.count}  sample=${r.sample ?? "—"}`);

  console.log("\nFiring 5 more (should short-circuit if google is in cool-down)...");
  const start2 = Date.now();
  const results2 = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      fetchSearxngResults(`smoke retry ${i} economy`).then((r) => r.length)
    )
  );
  console.log(`Wall: ${Date.now() - start2}ms, counts: ${results2.join(",")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

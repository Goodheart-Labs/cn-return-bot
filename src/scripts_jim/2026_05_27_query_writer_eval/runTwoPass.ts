/**
 * Run the two-pass query writer on a split.
 *
 *   bun run src/scripts_jim/2026_05_27_query_writer_eval/runTwoPass.ts \
 *     --split val --variant v17_twopass --concurrency 5
 */

import "dotenv/config";
import { runSplit } from "./evalHarness";
import { twoPassWrite } from "./twoPassWriter";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

async function main() {
  const split = arg("split", "val")!;
  const variant = arg("variant", "v17_twopass")!;
  const concurrency = arg("concurrency");
  const limit = arg("limit");

  await runSplit({
    split,
    variant,
    concurrency: concurrency ? parseInt(concurrency) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    queryGen: async (userMessage) => {
      const r = await twoPassWrite(userMessage);
      return { queries: r.queries };
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Run programmatic-expansion query writer.
 *
 *   bun run runExpanding.ts --split val --variant v22_expand_fc \
 *     --strategy fc_only
 *
 * Strategies: fc_only, snopes_only, fc_plus_snopes, fc_snopes_wiki
 */

import "dotenv/config";
import { runSplit } from "./evalHarness";
import { expandingWrite, type ExpansionStrategy } from "./expandingWriter";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

async function main() {
  const split = arg("split", "val")!;
  const variant = arg("variant", "v22_expand_fc")!;
  const strategy = (arg("strategy", "fc_only") as ExpansionStrategy);
  const concurrency = arg("concurrency");
  const limit = arg("limit");

  await runSplit({
    split,
    variant,
    concurrency: concurrency ? parseInt(concurrency) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    queryGen: async (userMessage) => {
      const r = await expandingWrite(userMessage, strategy);
      return { queries: r.queries };
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

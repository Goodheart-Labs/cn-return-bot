/**
 * Live-API test for the Opus native-search prompted-JSON fix.
 * Runs the REAL dispatchSearch path (web_search="native", Opus 4.8) over several
 * posts and asserts each returns a valid, parsed result — i.e. the prompted-JSON
 * + extractJsonObject change works end-to-end against the live model.
 *
 * Run: bun run src/scripts_jim/2026_07_08_opus_prompted_json/live_test.ts
 * Exits non-zero if any post throws or returns a malformed result.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botId: "simple-bot",
  search_model: "anthropic/claude-opus-4.8",
  web_search: "native",
};

const POSTS: string[] = [
  `Tweet to fact-check:\n"At 96, Clint Eastwood gave a speech last week saying he's lonely and abandoned by his family and that fame is worthless."`,
  `Tweet to fact-check:\n"The Great Wall of China is the only man-made structure visible from space with the naked eye."`,
  `Tweet to fact-check:\n"Drinking celery juice every morning cures type 2 diabetes within 30 days."`,
  `Tweet to fact-check:\n"NASA confirmed Earth will experience 15 minutes of total darkness on July 4th due to a rare planetary alignment."`,
];

function checkResult(r: { findings: unknown; correctionNeeded: unknown }): string[] {
  const errors: string[] = [];
  if (typeof r.findings !== "string" || r.findings.trim().length === 0) {
    errors.push(`findings not a non-empty string (got ${typeof r.findings})`);
  }
  if (typeof r.correctionNeeded !== "boolean") {
    errors.push(`correctionNeeded not a boolean (got ${typeof r.correctionNeeded})`);
  }
  return errors;
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  let failures = 0;
  for (const [i, post] of POSTS.entries()) {
    try {
      const r = await withBotConfig(config, () => dispatchSearch(post, `live_test.${i}`));
      const errors = checkResult(r);
      if (errors.length) {
        failures++;
        console.log(`FAIL  post ${i + 1}: ${errors.join("; ")}`);
      } else {
        console.log(
          `PASS  post ${i + 1}: correctionNeeded=${r.correctionNeeded}  findings[0..90]=${JSON.stringify(r.findings.slice(0, 90))}`,
        );
      }
    } catch (err) {
      failures++;
      console.log(`FAIL  post ${i + 1} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${POSTS.length - failures}/${POSTS.length} posts returned a valid parsed result via dispatchSearch`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

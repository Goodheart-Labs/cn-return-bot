/**
 * Writer-only smoke test for Mistral models.
 *
 * Calls runWriter() with a fixed (post, findings) pair for each Mistral variant
 * to confirm the model produces a valid note under our JSON schema + 280-char limit.
 * No web search; no media; no API costs beyond the writer call.
 */

import "dotenv/config";
import { withBotConfig, DEFAULT_CONFIG, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withTweetLog, createTweetLog } from "../../pipeline/utils/tweetLog";
import { runWriter } from "../../pipeline/simple-bot/writer";

const USER_MESSAGE = `Tweet to fact-check:
@someone — "BREAKING: Scientists confirm the Great Wall of China is visible from the Moon with the naked eye."`;

const FINDINGS = `## Search findings

NASA and multiple astronauts have stated the Great Wall of China is NOT visible from the Moon with the naked eye. From the Moon, even continents are barely distinguishable. Apollo astronaut Alan Bean and Chinese astronaut Yang Liwei have both confirmed they could not see the wall.

Sources:
- https://www.nasa.gov/feature/goddard/2008/great-wall-of-china-visible-from-space
- https://en.wikipedia.org/wiki/Great_Wall_of_China#Visibility_from_space
- https://www.scientificamerican.com/article/is-chinas-great-wall-visible-from-space/

Correction needed: YES.`;

const VARIANTS: Array<{ name: string; writer_model: string }> = [
  { name: "mistral-large-3",    writer_model: "mistralai/mistral-large-2512"  },
  { name: "mistral-medium-3.5", writer_model: "mistralai/mistral-medium-3-5"  },
  { name: "mistral-small-4",    writer_model: "mistralai/mistral-small-2603"  },
];

async function main(): Promise<void> {
  for (const v of VARIANTS) {
    const config: BotConfig = {
      ...DEFAULT_CONFIG,
      botId: "simple-bot",
      writer_model: v.writer_model,
    };
    const start = Date.now();
    try {
      const log = createTweetLog();
      const result = await withTweetLog(log, () =>
        withBotConfig(config, () =>
          withCostTracker(() => runWriter(USER_MESSAGE, FINDINGS)),
        ),
      );
      const ms = Date.now() - start;
      console.log(`\n=== ${v.name} (${v.writer_model}) — ${(ms / 1000).toFixed(1)}s ===`);
      console.log(`note (${result.noteText.length} chars):`);
      console.log(`  ${result.noteText}`);
      console.log(`sources:`);
      for (const s of result.sources) console.log(`  - ${s}`);
    } catch (err: any) {
      console.log(`\n=== ${v.name} FAILED ===`);
      console.log((err?.message ?? String(err)).slice(0, 500));
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

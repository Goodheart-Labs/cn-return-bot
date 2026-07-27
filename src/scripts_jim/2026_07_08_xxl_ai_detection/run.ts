/**
 * XXL-feed AI-content probe.
 *
 * Fetches the whole eligible-posts feed (xxl by default), keeps only long-form
 * (paid/premium) posts, ranks them 50/50 by recency+views, takes the top N, and
 * runs each through Pangram. Reports the share Pangram calls fully AI-generated
 * and lists every AI post (link · views · recency).
 *
 * Read-only w.r.t. X (GET feed only — never submits). On GitHub Actions the X_*
 * secrets are the admitted production note writer (xxl access). Locally pass
 * `--local` to route to LOCAL_X_* (small feed only) for a dry run.
 *
 * Env: FEED_SIZE, MAX_PAGES, TOP_N, MIN_CHARS, PANGRAM_CONCURRENCY, OUT_DIR.
 *
 * Run (prod, GH Actions):  bun run src/scripts_jim/2026_07_08_xxl_ai_detection/run.ts
 * Run (local dry run):     bun run src/scripts_jim/2026_07_08_xxl_ai_detection/run.ts --local
 */
import PQueue from "p-queue";
import { fetchEligiblePosts } from "../../api/fetchEligiblePosts";
import { buildPostSelection, type FeedSize } from "../../pipeline/orchestration/utils/feedSizeStrategy";
import { classifyText } from "./pangramClient";
import { selectLongFormPosts } from "./selectPosts";
import { buildReport, type AnalyzedPost } from "./report";

if (process.argv.includes("--local")) {
  // The admitted prod writer (xxl) lives only in GH Actions secrets. Locally the
  // only account that reads the real feed is LOCAL_X_*, and only at feed_size=small.
  process.env.X_API_KEY = process.env.LOCAL_X_API_KEY;
  process.env.X_API_KEY_SECRET = process.env.LOCAL_X_API_KEY_SECRET;
  process.env.X_ACCESS_TOKEN = process.env.LOCAL_X_ACCESS_TOKEN;
  process.env.X_ACCESS_TOKEN_SECRET = process.env.LOCAL_X_ACCESS_TOKEN_SECRET;
}

const FEED_SIZE = (process.env.FEED_SIZE ?? "xxl") as FeedSize;
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 1000);
const TOP_N = Number(process.env.TOP_N ?? 500);
const MIN_CHARS = Number(process.env.MIN_CHARS ?? 280);
const PANGRAM_CONCURRENCY = Number(process.env.PANGRAM_CONCURRENCY ?? 4);
const OUT_DIR = process.env.OUT_DIR ?? import.meta.dir;

// A ceiling well above any single feed; real termination is the feed's next_token.
const FETCH_ALL = 1_000_000;
const PROGRESS_LOG_EVERY = 25;

async function classifyAll(posts: Awaited<ReturnType<typeof fetchEligiblePosts>>): Promise<AnalyzedPost[]> {
  const queue = new PQueue({ concurrency: PANGRAM_CONCURRENCY });
  let done = 0;
  const tasks = posts.map((post) =>
    queue.add(async () => {
      const verdict = await classifyText(post.text);
      done++;
      if (done % PROGRESS_LOG_EVERY === 0 || done === posts.length) console.log(`[pangram] classified ${done}/${posts.length}`);
      return { post, verdict } satisfies AnalyzedPost;
    })
  );
  return (await Promise.all(tasks)) as AnalyzedPost[];
}

async function main() {
  console.log(`[run] Fetching ${FEED_SIZE} feed (up to ${MAX_PAGES} pages)...`);
  const posts = await fetchEligiblePosts(FETCH_ALL, new Set(), MAX_PAGES, buildPostSelection(FEED_SIZE));

  const { totalFetched, longFormCount, selected } = selectLongFormPosts(posts, TOP_N, MIN_CHARS);
  console.log(
    `[run] ${totalFetched} fetched → ${longFormCount} long-form (>${MIN_CHARS} chars) → analyzing top ${selected.length}`
  );
  if (selected.length === 0) {
    console.log("[run] No long-form posts to analyze; nothing to do.");
    return;
  }

  const analyzed = await classifyAll(selected);
  buildReport({ feedSize: FEED_SIZE, totalFetched, longFormCount, analyzed, outDir: OUT_DIR });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Capture the EXACT text handed to the search step for each Zvi note — the
 * `buildUserMessageFromInput` string that `processSingleTweet` feeds the search
 * model. For image-bearing claims this includes the "## Media on post" section
 * with Gemini's per-image descriptions, which is the interesting part.
 *
 * Reuses the pipeline's own post construction (`buildClaimPost`) and input build
 * (`createBotInput` + `buildUserMessageFromInput`) under the same forced picks
 * as checkClaim, so the captured string is byte-for-byte what search receives.
 *
 * READ-ONLY against prod (reads claims); writes searchInputs.json locally.
 * Runs media analysis (Gemini) for image claims — a few LLM calls.
 *
 *   bun run src/scripts_jim/2026_07_20_zvi_rerun_new_input/captureSearchInput.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { getSupabaseClient } from "../../api/supabaseClient";
import { buildClaimPost } from "../../everything/pipeline/checkClaims";
import { createBotInput } from "../../pipeline/input/createBotInput";
import { buildUserMessageFromInput } from "../../pipeline/prompts/input/userMessage";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { createTweetLog, withTweetLog } from "../../pipeline/utils/tweetLog";
import { closeBrowser } from "../../pipeline/utils/browserManager";
import type { ExtractedClaim, SourceKind } from "../../everything/types";

// Same pins checkClaims uses — the input stage depends on the media/config picks.
const FORCED_PICKS: Record<string, string> = {
  bot: "simple-bot",
  note_prefilter: "off",
  search_claim: "on",
  simple_bot_search: "opus48-native",
  simple_bot_writer: "sonnet5",
  simple_bot_verifier: "gemini-flash",
  verifier_citations: "on",
  verifier_claim_based: "classic",
};

const OUT = path.join(__dirname, "searchInputs.json");
const db = getSupabaseClient();

async function fetchAll<T>(table: string, columns: string, apply: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

interface ItemRow { id: string; source: SourceKind; published_at: string | null }
interface ClaimRow {
  id: string; item_id: string; claim: string; judgement: string;
  context_quote: string | null; context_paragraph: string | null;
  context_url: string | null; image_urls: string[] | null;
}

function toExtractedClaim(c: ClaimRow): ExtractedClaim {
  return {
    claim: c.claim,
    judgement: c.judgement,
    context: c.context_quote ?? "",
    contextParagraph: c.context_paragraph ?? "",
    imageUrls: c.image_urls ?? [],
    speculation: false,
    anchor: { kind: "substack", url: c.context_url ?? "" },
  };
}

/** Build the exact search-step input for one claim (media analysis included). */
async function captureInput(claim: ClaimRow, item: ItemRow, index: number): Promise<string> {
  const post = buildClaimPost({
    claim: toExtractedClaim(claim),
    source: item.source,
    itemId: item.id,
    index,
    publishedAt: item.published_at ?? undefined,
  });
  const { config } = withForcedPicks(FORCED_PICKS, () => runABTests(AB_TESTS));
  const log = createTweetLog();
  return withTweetLog(log, () =>
    withBotConfig(config, () =>
      withCostTracker(async () => {
        const input = await createBotInput(post, `zvi-capture-${index}`);
        return buildUserMessageFromInput(post, input);
      }),
    ),
  );
}

async function main() {
  const { data: proj } = await db.from("everything_projects").select("id").eq("slug", "zvi").single();
  if (!proj) throw new Error("no zvi project");
  const items = await fetchAll<ItemRow>("everything_items", "id, source, published_at", (q) =>
    q.eq("project_id", proj.id),
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemIds = items.map((i) => i.id);
  const claims = await fetchAll<ClaimRow>(
    "everything_claims",
    "id, item_id, claim, judgement, context_quote, context_paragraph, context_url, image_urls",
    (q) => q.in("item_id", itemIds).eq("status", "note").order("created_at"),
  );
  console.log(`capturing search input for ${claims.length} noted claims (${claims.filter((c) => (c.image_urls ?? []).length).length} with images)…\n`);

  const out: Array<{ claimId: string; imageUrls: string[]; searchInput: string }> = [];
  let done = 0;
  const queue = new PQueue({ concurrency: 4 });
  claims.forEach((claim, index) => {
    const item = itemById.get(claim.item_id)!;
    queue.add(async () => {
      const searchInput = await captureInput(claim, item, index);
      out.push({ claimId: claim.id, imageUrls: claim.image_urls ?? [], searchInput });
      const imgs = (claim.image_urls ?? []).length;
      console.log(`  [${++done}/${claims.length}] ${imgs ? `🖼️ ${imgs}img ` : ""}${claim.id.slice(0, 8)}`);
    });
  });
  await queue.onIdle();

  const orderById = new Map(claims.map((c, i) => [c.id, i]));
  out.sort((a, b) => orderById.get(a.claimId)! - orderById.get(b.claimId)!);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\ndone — ${out.length} inputs → ${OUT}`);
}

main()
  .catch((err) => {
    console.error("[captureSearchInput] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeBrowser();
    } catch {}
  });

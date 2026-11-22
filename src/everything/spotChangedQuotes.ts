/**
 * Finds posts that changed where one of our notes quotes them, and records
 * what the post says there now in everything_claims.updated_quote (migrations
 * 056 and 197). The note's card then shows "the source has since been updated
 * and now reads", and the note is listed on commonnotes.net/corrections.
 *
 * It reads again every text post with a passage quoted by a visible note that
 * has a Helpful vote, and compares each passage with the post as it reads now
 * (changedQuote.ts). It writes only when the text around the passage is still
 * there and other words stand in its place. A passage that was removed, or
 * rewritten with its surroundings, is only counted in the log.
 *
 *   bun run src/everything/spotChangedQuotes.ts [--dry-run]
 *
 * From GitHub: the workflow "Spot Changed Quotes" runs this once a day.
 */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../everything-core/paging";
import { compareQuote, type QuoteVerdict } from "./changedQuote";
import { fetchItem } from "./db";
import { bodyText } from "./pipeline/processContent";
import { fetchContent } from "./worker";

interface Candidate {
  claim_id: string;
  item_id: string;
  context_quote: string;
  url: string;
}

/** How many posts are read at once. */
const POSTS_AT_ONCE = 4;

/** The post as it reads now, or null when it cannot be read. */
async function readNow(url: string): Promise<string | null> {
  try {
    return bodyText(await fetchContent({ url, title: null, published_at: null, full_text: null }));
  } catch (err) {
    console.log(`unreadable: ${url}: ${(err as Error).message}`);
    return null;
  }
}

async function recordChange(claimId: string, nowReads: string): Promise<void> {
  // Only a claim nobody marked in the meantime is written.
  const { error } = await getSupabaseClient().from("everything_claims").update({ updated_quote: nowReads }).eq("id", claimId).is("updated_quote", null).is("quote_updated_at", null);
  if (error) throw new Error(`Supabase: ${error.message}`);
}

async function checkPost(candidates: Candidate[], dryRun: boolean, counts: Record<string, number>): Promise<void> {
  const { item_id: itemId, url } = candidates[0]!;
  const stored = (await fetchItem(itemId)).full_text;
  const live = stored === null ? null : await readNow(url);
  for (const candidate of candidates) {
    const verdict: QuoteVerdict | { kind: "unreadable" } = live === null ? { kind: "unreadable" } : compareQuote(candidate.context_quote, stored!, live);
    counts[verdict.kind] = (counts[verdict.kind] ?? 0) + 1;
    if (verdict.kind === "still_there" || verdict.kind === "not_in_stored" || verdict.kind === "unreadable") continue;
    console.log(`${verdict.kind}: ${url}\n  was: ${candidate.context_quote}${verdict.kind === "changed" ? `\n  now: ${verdict.nowReads}` : ""}`);
    if (verdict.kind === "changed" && !dryRun) await recordChange(candidate.claim_id, verdict.nowReads);
  }
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const candidates = await fetchAllRows<Candidate>(() => getSupabaseClient().rpc("everything_quote_check_candidates"), "claim_id", { label: "quote check candidates" });
  const byPost = Map.groupBy(candidates, (candidate) => candidate.item_id);
  const posts = [...byPost.values()];
  const counts: Record<string, number> = {};
  const worker = async () => {
    for (let post = posts.pop(); post; post = posts.pop()) {
      try {
        await checkPost(post, dryRun, counts);
      } catch (err) {
        counts.failed_posts = (counts.failed_posts ?? 0) + 1;
        console.log(`failed: ${post[0]!.url}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: POSTS_AT_ONCE }, worker));
  console.log(`${candidates.length} passages on ${byPost.size} posts${dryRun ? " (dry run, nothing written)" : ""}: ${JSON.stringify(counts)}`);
  if (counts.failed_posts) process.exit(1);
}

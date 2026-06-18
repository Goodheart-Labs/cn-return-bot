/**
 * Probe: what simple-bot / sonnet46-native search / gemini-flash writer runs
 * exist since 2026-05-28, and how do they break down by outcome/outcome_reason?
 * Informs the dataset labeling (wants_note vs no_note, exclude errors).
 */
import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";

const SINCE = "2026-05-28T00:00:00Z";

interface Run {
  id: string;
  tweet_id: string;
  ab_test_picks: Record<string, string> | null;
  outcome: string;
  outcome_reason: string | null;
  created_at: string;
}

async function main() {
  const client = getSupabaseClient();
  const runs = await fetchAllRows<Run>(
    () =>
      client
        .from("pipeline_runs")
        .select("id, tweet_id, ab_test_picks, outcome, outcome_reason, created_at")
        .eq("bot_name", "simple-bot")
        .gte("created_at", SINCE),
    "id",
    { label: "probe.simple_bot" },
  );

  console.log(`Total simple-bot runs since ${SINCE}: ${runs.length}`);

  const matches = runs.filter(
    (r) =>
      r.ab_test_picks?.["simple_bot_search"] === "sonnet46-native" &&
      r.ab_test_picks?.["simple_bot_writer"] === "gemini-flash",
  );
  console.log(`\nsonnet46-native search + gemini-flash writer: ${matches.length}`);

  const byOutcome = new Map<string, number>();
  for (const r of matches) {
    const key = `${r.outcome} / ${r.outcome_reason ?? "(none)"}`;
    byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
  }
  console.log("\nBreakdown (outcome / outcome_reason):");
  for (const [k, v] of [...byOutcome.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  // Unique tweets (dedupe — a tweet can have multiple runs)
  const uniqueTweets = new Set(matches.map((r) => r.tweet_id));
  console.log(`\nUnique tweet_ids among matches: ${uniqueTweets.size}`);

  // Also show the full search-variant distribution so we see what's available
  const bySearch = new Map<string, number>();
  for (const r of runs) {
    const s = r.ab_test_picks?.["simple_bot_search"] ?? "(none)";
    const w = r.ab_test_picks?.["simple_bot_writer"] ?? "(none)";
    const key = `search=${s}  writer=${w}`;
    bySearch.set(key, (bySearch.get(key) ?? 0) + 1);
  }
  console.log("\nAll search/writer combos for simple-bot:");
  for (const [k, v] of [...bySearch.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }
}

main().then(() => process.exit(0));

/**
 * Real-volume check of the probe_filter.ts gaps: scan the full eligible-feed
 * snapshots (feed_tweets, PR #273 — NOT pre-filtered by the topic predicate)
 * for posts that carry a missed-claim marker but do NOT match the current
 * trump_election_security Stage-1 predicate. This turns "the regex could miss
 * phrasing X" into "we actually saw N posts / M impressions phrased that way."
 *
 * READ-ONLY: selects from feed_tweets, writes nothing.
 *
 *   bun src/scripts_rob/2026_07_24_claim_coverage_audit/scan_feed_recall.ts
 *
 * Committed output: recall_summary.json (counts only, no tweet text).
 * Gitignored output: missed_samples.jsonl (verbatim text for eyeballing).
 */

import { createClient } from "@supabase/supabase-js";
import { fetchAllRows } from "../../api/paging";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";

const HERE = import.meta.dir;
const POSTED_SINCE = "2026-07-16";

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;

/** Markers for claim phrasings the probe showed the predicate misses.
 *  Loose on purpose — a human (or Stage 2) is the precision step; this only
 *  estimates how much talk exists in each gap. Authored lowercase. */
const MARKERS: Array<{ key: string; re: RegExp }> = [
  { key: "muskegon", re: /muskegon/ },
  { key: "burn_bags", re: /burn bags?/ },
  { key: "shadow_government", re: /shadow government/ },
  { key: "data_exploitation_unit", re: /data exploitation unit/ },
  { key: "presidential_daily_brief", re: /presidential daily brief/ },
  { key: "china_paid_journalists", re: /(pay|paid|paying)[^.]{0,40}journalists?|journalists?[^.]{0,40}(paid|large sums)/ },
  { key: "largest_compromise", re: /largest compromise/ },
  { key: "most_secure_election", re: /most secure election/ },
  { key: "coverup_plus_election_term", re: /cover[- ]?up|covered (it )?up|cover story/ },
  { key: "slow_count_california", re: /(days?|weeks?|month) to count|still counting|to count the votes?|third world country/ },
  { key: "ballots_through_mail", re: /ballots?[^.]{0,40}\bmail\b|\bmail\b[^.]{0,40}ballots?/ },
  { key: "network_blackout", re: /(refused|declined) to (air|cover|broadcast)|blacked? ?out (the )?(speech|address)/ },
  { key: "278_dot_form", re: /\b2[5-8]\d\.\d{3}\b/ },
  { key: "gift_cards_registration", re: /gift cards?/ },
];

/** Election-context gate for markers too generic to count alone. */
const NEEDS_ELECTION_CONTEXT = new Set([
  "coverup_plus_election_term",
  "china_paid_journalists",
  "gift_cards_registration",
  "slow_count_california",
  "network_blackout",
]);
const ELECTION_CONTEXT =
  /\b(elections?|voters?|voting|votes?|ballots?|registrations?)\b|declassif|deep state|trump|speech|address/;

interface Row {
  tweet_id: string;
  text: string | null;
  referenced_tweet_data: { text?: string } | null;
  posted_at: string | null;
  impressions: number | null;
}

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const rows = await fetchAllRows<Row>(
  () =>
    client
      .from("feed_tweets")
      .select("tweet_id, text, referenced_tweet_data, posted_at, impressions")
      .gte("posted_at", POSTED_SINCE),
  "tweet_id",
  { label: "claim-coverage feed_tweets" },
);

const summary: Record<string, { seen: number; alreadyMatched: number; missed: number; missedImpressions: number }> = {};
for (const m of MARKERS) summary[m.key] = { seen: 0, alreadyMatched: 0, missed: 0, missedImpressions: 0 };

const samples: string[] = [];
let predicateHits = 0;
for (const row of rows) {
  const blob = `${row.text ?? ""}\n${row.referenced_tweet_data?.text ?? ""}`.toLowerCase();
  const matched = topic.matches(blob);
  if (matched) predicateHits++;
  for (const m of MARKERS) {
    if (!m.re.test(blob)) continue;
    if (NEEDS_ELECTION_CONTEXT.has(m.key) && !ELECTION_CONTEXT.test(blob)) continue;
    const s = summary[m.key]!;
    s.seen++;
    if (matched) s.alreadyMatched++;
    else {
      s.missed++;
      s.missedImpressions += row.impressions ?? 0;
      samples.push(
        JSON.stringify({
          marker: m.key,
          tweet_id: row.tweet_id,
          posted_at: row.posted_at,
          impressions: row.impressions,
          text: row.text,
          quoted: row.referenced_tweet_data?.text ?? null,
        }),
      );
    }
  }
}

const out = {
  scanned_rows: rows.length,
  posted_since: POSTED_SINCE,
  predicate_hits: predicateHits,
  markers: summary,
};
await Bun.write(`${HERE}/recall_summary.json`, JSON.stringify(out, null, 2) + "\n");
await Bun.write(`${HERE}/missed_samples.jsonl`, samples.join("\n") + "\n");
console.log(JSON.stringify(out, null, 2));
console.log(`\n${samples.length} missed-post samples → missed_samples.jsonl (gitignored)`);

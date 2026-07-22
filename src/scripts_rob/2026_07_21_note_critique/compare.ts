/**
 * Head-to-head: our notes on this topic vs the ecosystem notes that actually
 * got rated. Read-only.
 *
 * The funnel work (#293, #294) fixed discovery. It cannot fix the fact that
 * ~90% of notes on this topic never accrue enough ratings to be decided. This
 * script assembles the evidence for the writer-side question: do our notes
 * already look like the ones that win, or not?
 *
 * Three corpora:
 *   OURS      — notes the bot submitted on topic-sighted tweets (notes table)
 *   SHOWN     — ecosystem notes on this topic rated Helpful (the bar)
 *   UNDECIDED — ecosystem notes on this topic that never got enough ratings
 *               (the failure mode we're trying to avoid, not a quality signal)
 *
 * Prints every one of our notes in full — the qualitative read is the point;
 * the medians are only there to show which way to look.
 *
 *   bun run src/scripts_rob/2026_07_21_note_critique/compare.ts
 */

import { SupabaseLogger } from "../../api/supabaseClient";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const AUDIT = "src/scripts_rob/2026_07_21_missed_opportunity_audit/audit.json";
const OUT_DIR = "src/scripts_rob/2026_07_21_note_critique";

interface Topical {
  noteId: string; tweetId: string; status?: string;
  summary: string; tweetText: string; hoursToStatus: number | null;
}
const audit = JSON.parse(readFileSync(AUDIT, "utf8")) as { topical_by_status: Topical[] };
const shown = audit.topical_by_status.filter((n) => n.status === "CURRENTLY_RATED_HELPFUL");
const notHelpful = audit.topical_by_status.filter((n) => n.status === "CURRENTLY_RATED_NOT_HELPFUL");
const undecided = audit.topical_by_status.filter((n) => n.status === "NEEDS_MORE_RATINGS");

// ── Our notes on topic-sighted tweets ────────────────────────────────────────
const logger = new SupabaseLogger();
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string; topic_id: string; needs_note: boolean | null }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id, topic_id, needs_note")
    .eq("topic_id", "trump_election_security"),
  "id", "sightings");
const sightedIds = new Set(sightings.map((s) => s.tweet_id));

const allNotes = await logger.fetchAllRows<{
  id: string; note_id: string; tweet_id: string; note_text: string; source_url: string | null;
  submitted_at: string; cn_status: string | null; rating_count: number | null;
  helpful_count: number; not_helpful_count: number; somewhat_helpful_count: number | null; view_count: number | null;
}>(
  (c) => c.from("notes").select("id, note_id, tweet_id, note_text, source_url, submitted_at, cn_status, rating_count, helpful_count, not_helpful_count, somewhat_helpful_count, view_count")
    .gte("submitted_at", "2026-07-16"),
  "id", "notes since 7/16");
const ours = allNotes.filter((n) => sightedIds.has(n.tweet_id));

// Tweet text for our notes (backfilled 7/20 — coverage should be complete)
const ourTweets = await logger.fetchAllRows<{ tweet_id: string; text: string }>(
  (c) => c.from("tweets").select("tweet_id, text").in("tweet_id", ours.map((n) => n.tweet_id)),
  "tweet_id", "our tweets");
const tweetText = new Map(ourTweets.map((t) => [t.tweet_id, t.text]));
const missingText = ours.filter((n) => !tweetText.has(n.tweet_id));
if (missingText.length) console.warn(`⚠ ${missingText.length} of our notes have no tweets row (backfill gap?)`);

// ── Shape metrics ────────────────────────────────────────────────────────────
const urlsIn = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const median = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0;

function shape(label: string, texts: string[]) {
  if (!texts.length) return console.log(`\n${label}: none`);
  const lens = texts.map((t) => t.length);
  const urlCounts = texts.map((t) => urlsIn(t).length);
  const domains = new Map<string, number>();
  for (const t of texts) for (const u of urlsIn(t)) {
    const d = domainOf(u);
    if (d) domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  const over280 = texts.filter((t) => t.length > 280).length;
  console.log(`\n${label} (n=${texts.length})`);
  console.log(`  length: median ${median(lens)}, range ${Math.min(...lens)}–${Math.max(...lens)}, over 280 chars: ${over280} (${((100 * over280) / texts.length).toFixed(0)}%)`);
  console.log(`  URLs per note: median ${median(urlCounts)}, none at all: ${urlCounts.filter((c) => !c).length}`);
  console.log(`  sources: ${[...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, c]) => `${d}(${c})`).join(" ") || "—"}`);
}

console.log(`\n=== shape: ours vs what gets rated ===`);
shape("OURS (bot notes on topic-sighted tweets)", ours.map((n) => n.note_text));
shape("SHOWN (ecosystem, rated Helpful)", shown.map((n) => n.summary));
shape("NOT HELPFUL (ecosystem, rated down)", notHelpful.map((n) => n.summary));
shape("UNDECIDED (ecosystem, never enough ratings)", undecided.map((n) => n.summary));

// ── Our notes, in full, with whatever outcome we have ────────────────────────
console.log(`\n\n=== our ${ours.length} notes on this topic, in full ===`);
for (const n of ours.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
  console.log(`\n[${n.submitted_at.slice(0, 16)}]  status=${n.cn_status ?? "—"}  ratings=${n.rating_count ?? 0} (helpful ${n.helpful_count} / somewhat ${n.somewhat_helpful_count ?? 0} / not ${n.not_helpful_count})  views=${n.view_count ?? "—"}`);
  console.log(`  POST: ${(tweetText.get(n.tweet_id) ?? "(no tweets row)").replace(/\s+/g, " ").slice(0, 220)}`);
  console.log(`  NOTE: ${n.note_text.replace(/\s+/g, " ")}`);
  console.log(`  (${n.note_text.length} chars, ${urlsIn(n.note_text).length} url)`);
}

// ── The bar: every shown note, in full ───────────────────────────────────────
console.log(`\n\n=== the bar: every ecosystem note on this topic that reached Helpful ===`);
for (const n of shown.sort((a, b) => (a.hoursToStatus ?? 1e9) - (b.hoursToStatus ?? 1e9))) {
  console.log(`\n[Helpful${n.hoursToStatus !== null ? ` in ${n.hoursToStatus.toFixed(1)}h` : ""}]  (${n.summary.length} chars)`);
  console.log(`  POST: ${n.tweetText.slice(0, 220)}`);
  console.log(`  NOTE: ${n.summary}`);
}

// ── And the ones raters actively rejected ────────────────────────────────────
console.log(`\n\n=== rated NOT HELPFUL — the failure mode with a verdict attached ===`);
for (const n of notHelpful) {
  console.log(`\n[Not Helpful]  (${n.summary.length} chars)`);
  console.log(`  POST: ${n.tweetText.slice(0, 220)}`);
  console.log(`  NOTE: ${n.summary}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/corpus.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  ours: ours.map((n) => ({ noteId: n.note_id, tweetId: n.tweet_id, text: n.note_text,
    tweetText: tweetText.get(n.tweet_id) ?? null,
    status: n.cn_status, ratingCount: n.rating_count, helpful: n.helpful_count,
    notHelpful: n.not_helpful_count, views: n.view_count, submittedAt: n.submitted_at })),
  shown, notHelpful, undecided,
}, null, 2));
console.log(`\nwrote ${OUT_DIR}/corpus.json  (ours=${ours.length} shown=${shown.length} notHelpful=${notHelpful.length} undecided=${undecided.length})`);

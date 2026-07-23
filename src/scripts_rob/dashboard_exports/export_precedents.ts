/**
 * Dashboard export #5 — historical precedent (read-only).
 *
 * Before and after the 7/16 speech, how has Community Notes handled this kind
 * of content ecosystem-wide? Feeds the dashboard's precedent section:
 *
 *  - weekly_shown_rate — notes matched to the topic (strict = live topic
 *    predicate on the note text; broad = wider election regex) vs the
 *    all-notes baseline: what fraction is currently rated Helpful, by week
 *    of creation.
 *  - winners — the election notes that DID reach Helpful: when, how fast,
 *    what they said (note text is X's own published research dataset), with
 *    the tweet link. The "what winning looks like" corpus.
 *  - anatomy — shown vs not-shown vs undecided strict-topic notes: length,
 *    URL share, top cited domains.
 *  - our_posts_vs_ecosystem — of the topic posts WE sighted, how many carry
 *    anyone else's note, and did any of those display.
 *
 * Our own notes are excluded everywhere — this section is about the ecosystem
 * we're operating inside. Note text is matched on note summaries (a proxy for
 * the tweet's content; the dump doesn't carry tweet text).
 *
 *   bun run src/scripts_rob/dashboard_exports/export_precedents.ts [--out <file>] [--dump-dir ./cn-data]
 */

import { readdirSync, statSync } from "node:fs";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger } from "../../api/supabaseClient";
import { forEachTsvRow } from "./tsv";

const TOPIC_ID = "trump_election_security";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z"); // 4 weeks pre-speech
const SPEECH = Date.parse("2026-07-16T00:00:00Z");
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";

const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/precedents.json`;
const dumpIdx = process.argv.indexOf("--dump-dir");
const DUMP_DIR = dumpIdx !== -1 ? process.argv[dumpIdx + 1]! : "./cn-data";

const topic = MISINFO_TOPICS.find((t) => t.id === TOPIC_ID)!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;
const logger = new SupabaseLogger();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const pctNum = (a: number, b: number) => (b ? Number(((100 * a) / b).toFixed(1)) : null);
const week = (ms: number) => {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // Monday
  return day.toISOString().slice(0, 10);
};

// ── DB: our sighted topic tweets + our own note ids (excluded everywhere) ────
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", TOPIC_ID),
  "id", "sightings");
const ourTweets = new Set(sightings.map((s) => s.tweet_id));
const ourNoteIds = new Set((await logger.fetchAllRows<{ note_id: string }>(
  (c) => c.from("notes").select("note_id"), "note_id", "our notes")).map((n) => n.note_id));

// ── Pass 1: notes ────────────────────────────────────────────────────────────
interface Matched { noteId: string; tweetId: string; createdAtMillis: number; tier: "strict" | "broad"; summary: string }
const matched = new Map<string, Matched>();
const baselineWindowIds = new Set<string>();
const notesOnOurTweets = new Map<string, { tweetId: string }>();

await forEachTsvRow(DUMP_DIR, "notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const noteId = cols[i("noteId")]!;
  if (ourNoteIds.has(noteId)) return; // ecosystem only
  const created = Number(cols[i("createdAtMillis")]);
  const tweetId = cols[i("tweetId")]!;
  const summary = cols[i("summary")] ?? "";

  if (ourTweets.has(tweetId)) notesOnOurTweets.set(noteId, { tweetId });
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  baselineWindowIds.add(noteId);
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;
  const tier = topic.matches(summary.toLowerCase()) ? "strict" : BROAD.test(summary) ? "broad" : null;
  if (tier) matched.set(noteId, { noteId, tweetId, createdAtMillis: created, tier, summary });
});
console.error(`[precedents] ${baselineWindowIds.size} baseline notes since window; ${matched.size} election-matched; ` +
  `${notesOnOurTweets.size} ecosystem notes on our sighted tweets`);

// ── Pass 2: status history ───────────────────────────────────────────────────
interface Bucket { total: number; helpful: number }
const buckets = new Map<string, Bucket>(); // `${week}|${baseline|broad|strict}`
const bump = (key: string, helpful: boolean) => {
  const b = buckets.get(key) ?? { total: 0, helpful: 0 };
  b.total++;
  if (helpful) b.helpful++;
  buckets.set(key, b);
};
const winners: (Matched & { hoursToHelpful: number | null })[] = [];
const statusByNote = new Map<string, string>(); // matched + our-tweet notes
await forEachTsvRow(DUMP_DIR, "noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const noteId = cols[i("noteId")]!;
  const status = cols[i("currentStatus")] ?? "";
  if (notesOnOurTweets.has(noteId)) statusByNote.set(noteId, status);
  if (!baselineWindowIds.has(noteId)) return;

  const m = matched.get(noteId);
  const created = m?.createdAtMillis ?? Number(cols[i("createdAtMillis")]);
  const w = week(created);
  bump(`${w}|baseline`, status === HELPFUL);
  if (!m) return;
  statusByNote.set(noteId, status);
  bump(`${w}|${m.tier}`, status === HELPFUL);
  if (status === HELPFUL) {
    const firstMs = Number(cols[i("timestampMillisOfFirstNonNMRStatus")]);
    const hours = cols[i("firstNonNMRStatus")] === HELPFUL && Number.isFinite(firstMs) && firstMs > 0
      ? Number(((firstMs - m.createdAtMillis) / 3.6e6).toFixed(1)) : null;
    winners.push({ ...m, hoursToHelpful: hours });
  }
});

// ── Assemble ─────────────────────────────────────────────────────────────────
const weeks = [...new Set([...buckets.keys()].map((k) => k.split("|")[0]!))].sort();
const weeklyShownRate = weeks.map((w) => {
  const cell = (tier: string) => {
    const b = buckets.get(`${w}|${tier}`);
    return b ? { notes: b.total, shown: b.helpful, shown_pct: pctNum(b.helpful, b.total) } : null;
  };
  return {
    week_of: w,
    speech_week: Date.parse(w) <= SPEECH && Date.parse(w) + 7 * 864e5 > SPEECH,
    baseline: cell("baseline"),
    broad_election: cell("broad"),
    strict_topic: cell("strict"),
  };
});

const winnersOut = winners
  .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
  .map((x) => ({
    created: new Date(x.createdAtMillis).toISOString().slice(0, 10),
    pre_speech: x.createdAtMillis < SPEECH,
    tier: x.tier,
    hours_to_helpful: x.hoursToHelpful,
    tweet_url: `https://x.com/i/status/${x.tweetId}`,
    note_text: clean(x.summary).slice(0, 300),
  }));
const helpfulHours = winners.map((x) => x.hoursToHelpful).filter((v): v is number => v != null).sort((a, b) => a - b);

const urlsIn = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
function anatomy(notes: Matched[]) {
  if (!notes.length) return null;
  const lens = notes.map((n) => n.summary.length).sort((a, b) => a - b);
  const withUrl = notes.filter((n) => urlsIn(n.summary).length > 0).length;
  const domains = new Map<string, number>();
  for (const n of notes) for (const u of urlsIn(n.summary)) {
    const d = domainOf(u);
    if (d) domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  return {
    notes: notes.length,
    median_chars: lens[Math.floor(lens.length / 2)]!,
    with_url_pct: pctNum(withUrl, notes.length),
    top_domains: Object.fromEntries([...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
  };
}
const strict = [...matched.values()].filter((m) => m.tier === "strict");
const statusOf = (m: Matched) => statusByNote.get(m.noteId) ?? "";

const notedOurTweets = new Set([...notesOnOurTweets.values()].map((n) => n.tweetId));
const shownOnOurs = new Set([...notesOnOurTweets.entries()]
  .filter(([id]) => statusByNote.get(id) === HELPFUL)
  .map(([, n]) => n.tweetId));

const statusFiles = readdirSync(DUMP_DIR).filter((f) => f.startsWith("noteStatusHistory") && f.endsWith(".tsv"));
const out = {
  generated_at: new Date().toISOString(),
  topic: "Election-security address (2026-07-16) — curated topic",
  window_start: new Date(WINDOW_START).toISOString().slice(0, 10),
  dump_as_of: statusFiles.length ? statSync(`${DUMP_DIR}/${statusFiles[0]}`).mtime.toISOString() : null,
  field_notes: {
    matching: "notes matched on their own text (strict = the live topic predicate, broad = wider election terms) — a proxy for the tweet's content, which the public dump doesn't carry",
    shown: "shown = currently rated Helpful; notes later flipped away don't count; dump lags ~48h so recent weeks undercount",
    winners: "note text is from X's published Community Notes research dataset; our own notes are excluded throughout",
  },
  weekly_shown_rate: weeklyShownRate,
  winners: {
    count: winnersOut.length,
    median_hours_to_helpful: helpfulHours.length ? helpfulHours[Math.floor(helpfulHours.length / 2)]! : null,
    notes: winnersOut,
  },
  anatomy_strict_topic: {
    shown: anatomy(strict.filter((m) => statusOf(m) === HELPFUL)),
    not_helpful: anatomy(strict.filter((m) => statusOf(m) === NOT_HELPFUL)),
    undecided: anatomy(strict.filter((m) => statusOf(m) !== HELPFUL && statusOf(m) !== NOT_HELPFUL)),
  },
  our_posts_vs_ecosystem: {
    posts_sighted: ourTweets.size,
    with_anyones_note: notedOurTweets.size,
    with_anyones_note_pct: pctNum(notedOurTweets.size, ourTweets.size),
    with_displaying_note: shownOnOurs.size,
  },
};
await Bun.write(OUT, JSON.stringify(out, null, 2));

console.log(`\nprecedents → ${OUT}\n`);
console.log("week(Mon)    baseline           broad              strict");
for (const w of weeklyShownRate) {
  const cell = (b: { notes: number; shown: number; shown_pct: number | null } | null) =>
    b ? `${b.shown_pct ?? 0}% (${b.shown}/${b.notes})`.padEnd(17) : "–".padEnd(17);
  console.log(`${w.week_of}   ${cell(w.baseline)}  ${cell(w.broad_election)}  ${cell(w.strict_topic)}${w.speech_week ? " ← speech" : ""}`);
}
console.log(`\nwinners: ${winnersOut.length} (median hours-to-Helpful ${out.winners.median_hours_to_helpful ?? "?"})`);
console.log(`our posts: ${notedOurTweets.size}/${ourTweets.size} with anyone's note; ${shownOnOurs.size} displaying`);
console.log(`anatomy (shown strict): ${JSON.stringify(out.anatomy_strict_topic.shown)}`);

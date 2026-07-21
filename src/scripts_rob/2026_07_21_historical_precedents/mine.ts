/**
 * Historical precedents: how did Community Notes handle election-claim posts
 * BEFORE the 7/16 speech — and what did the winners look like? (read-only)
 *
 * Inputs: X's public dump in ./cn-data (notes-*.tsv, noteStatusHistory-*.tsv;
 * download via updateNoteFeedback's URL convention). Two streaming passes —
 * files are multi-GB, nothing is slurped:
 *
 *  Pass 1 (notes): every note created since WINDOW_START is bucketed by week
 *    and matched two ways against its summary text:
 *      strict = the live topic predicate (topics.ts matches()) — speech-topic;
 *      broad  = election regex — the wider election-misinfo conversation.
 *    Also: any note (all-time) on one of OUR sighted topic tweets is recorded
 *    (the "% of our posts with someone's note" number for the dashboard).
 *
 *  Pass 2 (status history): shown-rate per bucket (currentStatus ==
 *    CURRENTLY_RATED_HELPFUL) for matched notes vs the all-notes baseline,
 *    plus time-to-first-Helpful for the winners.
 *
 * Output: console tables + precedents.json (matched shown notes with tweetId,
 * summary, timing — input for the follow-up tweet lookup via read-only X API).
 *
 * Caveats: "shown" = current status, so notes later flipped away from Helpful
 * don't count; dump lags ~48h so the newest days undercount; note summary text
 * is a proxy for the tweet's content (the tweet itself isn't in the dump).
 *
 *   bun run src/scripts_rob/2026_07_21_historical_precedents/mine.ts
 */

import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger } from "../../api/supabaseClient";
import { readdirSync } from "node:fs";

const DATA_DIR = "./cn-data";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z"); // 4 weeks pre-speech
const SPEECH = Date.parse("2026-07-16T00:00:00Z");
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const OUT = `${import.meta.dir}/precedents.json`;

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;

const week = (ms: number) => {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // Monday
  return day.toISOString().slice(0, 10);
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");

/** Stream TSV rows across partitions without loading whole files. */
async function forEachTsvRow(prefix: string, cb: (cols: string[], header: string[]) => void) {
  const paths = readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".tsv")).sort();
  if (!paths.length) throw new Error(`no ${prefix}*.tsv in ${DATA_DIR} — download the dump first`);
  let header: string[] | null = null;
  for (const p of paths) {
    let carry = "";
    const decoder = new TextDecoder();
    const reader = Bun.file(`${DATA_DIR}/${p}`).stream().getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const text = carry + decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const cols = line.split("\t");
        if (!header) { header = cols; continue; }
        if (cols[0] === header[0]) continue; // repeated header in later partitions
        cb(cols, header);
      }
    }
    if (carry && header) cb(carry.split("\t"), header);
  }
}

// ── Our sighted topic tweets (for the intersect) ─────────────────────────────
const logger = new SupabaseLogger();
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", "trump_election_security"),
  "id", "sightings");
const ourTweets = new Set(sightings.map((s) => s.tweet_id));

// ── Pass 1: notes ────────────────────────────────────────────────────────────
interface Matched { noteId: string; tweetId: string; createdAtMillis: number; tier: "strict" | "broad"; summary: string }
const matched = new Map<string, Matched>();
const baselineWindowIds = new Set<string>(); // all notes since WINDOW_START (shown-rate baseline)
const notesOnOurTweets = new Map<string, { tweetId: string; createdAtMillis: number; summary: string }>();
let totalNotes = 0;

await forEachTsvRow("notes-", (cols, h) => {
  totalNotes++;
  const i = (name: string) => h.indexOf(name);
  const created = Number(cols[i("createdAtMillis")]);
  const noteId = cols[i("noteId")]!;
  const tweetId = cols[i("tweetId")]!;
  const summary = cols[i("summary")] ?? "";

  if (ourTweets.has(tweetId)) {
    notesOnOurTweets.set(noteId, { tweetId, createdAtMillis: created, summary: summary.slice(0, 280) });
  }
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  baselineWindowIds.add(noteId);
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;

  const blob = summary.toLowerCase();
  const tier = topic.matches(blob) ? "strict" : BROAD.test(summary) ? "broad" : null;
  if (tier) matched.set(noteId, { noteId, tweetId, createdAtMillis: created, tier, summary: summary.slice(0, 280) });
});
console.log(`\n[pass 1] ${totalNotes} notes in dump; ${baselineWindowIds.size} since ${new Date(WINDOW_START).toISOString().slice(0, 10)}; ` +
  `${matched.size} election-matched (${[...matched.values()].filter((m) => m.tier === "strict").length} strict); ` +
  `${notesOnOurTweets.size} notes on ${new Set([...notesOnOurTweets.values()].map((n) => n.tweetId)).size} of our ${ourTweets.size} sighted tweets`);

// ── Pass 2: status history ───────────────────────────────────────────────────
interface Bucket { total: number; helpful: number }
const bucketOf = new Map<string, Bucket>(); // key: `${week}|${tier}` or `${week}|baseline`
const bump = (key: string, helpful: boolean) => {
  const b = bucketOf.get(key) ?? { total: 0, helpful: 0 };
  b.total++;
  if (helpful) b.helpful++;
  bucketOf.set(key, b);
};
const winners: (Matched & { hoursToHelpful: number | null })[] = [];
const ourTweetNoteStatus = new Map<string, string>(); // noteId → currentStatus

await forEachTsvRow("noteStatusHistory-", (cols, h) => {
  const i = (name: string) => h.indexOf(name);
  const noteId = cols[i("noteId")]!;
  const status = cols[i("currentStatus")] ?? "";
  const isHelpful = status === HELPFUL;

  if (notesOnOurTweets.has(noteId)) ourTweetNoteStatus.set(noteId, status);
  if (!baselineWindowIds.has(noteId)) return;

  const m = matched.get(noteId);
  const created = m?.createdAtMillis ?? Number(cols[i("createdAtMillis")]);
  const w = week(created);
  bump(`${w}|baseline`, isHelpful);
  if (!m) return;
  bump(`${w}|${m.tier}`, isHelpful);
  if (isHelpful) {
    const firstMs = Number(cols[i("timestampMillisOfFirstNonNMRStatus")]);
    const hours = cols[i("firstNonNMRStatus")] === HELPFUL && Number.isFinite(firstMs) && firstMs > 0
      ? (firstMs - m.createdAtMillis) / 3.6e6 : null;
    winners.push({ ...m, hoursToHelpful: hours });
  }
});

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n== shown-rate by week created (shown = currentStatus CURRENTLY_RATED_HELPFUL) ==`);
console.log("week(Mon)    baseline            broad-election      strict-topic");
const weeks = [...new Set([...bucketOf.keys()].map((k) => k.split("|")[0]!))].sort();
for (const w of weeks) {
  const cell = (tier: string) => {
    const b = bucketOf.get(`${w}|${tier}`);
    return b ? `${pct(b.helpful, b.total)} (${b.helpful}/${b.total})`.padEnd(18) : "–".padEnd(18);
  };
  const mark = Date.parse(w) < SPEECH && Date.parse(w) + 7 * 864e5 > SPEECH ? "  ← speech week" : "";
  console.log(`${w}   ${cell("baseline")}  ${cell("broad")}  ${cell("strict")}${mark}`);
}

console.log(`\n== pre-speech winners: election notes created before 7/16 now rated Helpful ==`);
const pre = winners.filter((x) => x.createdAtMillis < SPEECH).sort((a, b) => b.createdAtMillis - a.createdAtMillis);
for (const x of pre) {
  const t = x.hoursToHelpful == null ? "     ?" : `${x.hoursToHelpful.toFixed(0).padStart(4)}h`;
  console.log(`  ${new Date(x.createdAtMillis).toISOString().slice(0, 10)}  [${x.tier}] to-Helpful ${t}  tweet ${x.tweetId}`);
  console.log(`      ${x.summary.replace(/\s+/g, " ").slice(0, 150)}`);
}

const shownOnOurs = new Set([...ourTweetNoteStatus.entries()].filter(([, s]) => s === HELPFUL)
  .map(([id]) => notesOnOurTweets.get(id)!.tweetId));
const notedOurs = new Set([...notesOnOurTweets.values()].map((n) => n.tweetId));
console.log(`\n== our ${ourTweets.size} sighted topic tweets vs the dump ==`);
console.log(`  with any note written (anyone, all-time): ${notedOurs.size} (${pct(notedOurs.size, ourTweets.size)})`);
console.log(`  with a note SHOWN: ${shownOnOurs.size} (${pct(shownOnOurs.size, ourTweets.size)}) — tweets: ${[...shownOnOurs].join(", ") || "none"}`);

await Bun.write(OUT, JSON.stringify({
  generated_at: new Date().toISOString(),
  window_start: new Date(WINDOW_START).toISOString(),
  winners: winners.sort((a, b) => b.createdAtMillis - a.createdAtMillis),
  our_tweets: { sighted: ourTweets.size, with_any_note: notedOurs.size, with_shown_note: [...shownOnOurs] },
}, null, 2));
console.log(`\nwinners + intersect → ${OUT}`);

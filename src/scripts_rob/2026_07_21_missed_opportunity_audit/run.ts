/**
 * Missed-opportunity audit (read-only). Three questions in one dump pass:
 *
 *  §1 OUTCOMES — the topic-predicate posts that came through the REGULAR feed
 *     untreated (the 268 that PR #293 now catches): did the ecosystem note
 *     them, and did those notes get SHOWN? This is the value-of-the-fix
 *     measurement. The XXL-sighted population is the control (2/475 noted,
 *     0 shown) — if the regular-feed population scores materially better, the
 *     small feed really is where the rating attention lives.
 *
 *  §2 RECALL — of the tweets the ecosystem noted whose TEXT we actually hold,
 *     how many does our stage-1 keyword predicate match? Earlier work matched
 *     on NOTE summaries as a proxy; this measures the real filter against real
 *     tweet text and prints the misses, which is the actionable leak list.
 *
 *  §3 ANATOMY — shown vs not-shown notes on this topic: length, URL presence,
 *     source domains. A cheap quantitative read on what wins, and the corpus
 *     for the qualitative critique pass.
 *
 *   bun run src/scripts_rob/2026_07_21_missed_opportunity_audit/run.ts
 */

import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger, getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const DATA_DIR = "./cn-data";
const OUT_DIR = "src/scripts_rob/2026_07_21_missed_opportunity_audit";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z");
const SHOWN = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

async function forEachTsvRow(prefix: string, cb: (cols: string[], header: string[]) => void) {
  const paths = readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".tsv")).sort();
  if (!paths.length) throw new Error(`no ${prefix}*.tsv in ${DATA_DIR}`);
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
        if (cols[0] === header[0]) continue;
        cb(cols, header);
      }
    }
    if (carry && header) cb(carry.split("\t"), header);
  }
}

// ── Our tweet-text corpus (tweets table + hourly capture) ────────────────────
const logger = new SupabaseLogger();
// first_seen_at is unindexed and trips statement_timeout, so range-scan the PK:
// snowflake ids are time-ordered and all current ids are 19 digits (text compare
// == numeric compare). Filter first_seen_at in JS. Caveat: excludes old posts
// first seen recently — a slight undercount of the corpus, not of the topic set.
const ID_FLOOR = "2066000000000000000"; // ≈ posted 2026-06-15
const processed = await fetchAllRows<{ tweet_id: string; text: string | null; first_seen_at: string | null }>(
  () => getSupabaseClient().from("tweets").select("tweet_id, text, first_seen_at").gt("tweet_id", ID_FLOOR),
  "tweet_id", { label: "tweets by id range", pageSize: 500 });
const sightings = new Set((await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", "trump_election_security"),
  "id", "sightings")).map((s) => s.tweet_id));

/** tweetId → text, from every surface that stores text. */
const textById = new Map<string, string>();
for (const t of processed) if (t.text) textById.set(t.tweet_id, t.text);
for (const line of readFileSync("capture-data/trump-election-fraud.jsonl", "utf8").split("\n").filter(Boolean)) {
  try {
    const j = JSON.parse(line) as { tweet_id?: string; id?: string; text?: string };
    const id = String(j.tweet_id ?? j.id ?? "");
    if (id && j.text && !textById.has(id)) textById.set(id, j.text);
  } catch { /* skip malformed capture line */ }
}

// The population PR #293 unlocks: topic-predicate posts the regular pass handled
// generically (never sighted) since the speech.
const regularTopicPosts = processed.filter((t) =>
  (t.first_seen_at ?? "") >= "2026-07-16" && !sightings.has(t.tweet_id) &&
  t.text && topic.matches(t.text.toLowerCase()));
const regularIds = new Set(regularTopicPosts.map((t) => t.tweet_id));

// ── Dump pass 1: notes ───────────────────────────────────────────────────────
interface DNote {
  noteId: string; tweetId: string; createdAtMillis: number;
  summary: string; tier: "strict" | "broad" | null;
  status?: string; firstStatusMillis?: number;
}
/** Every note on a tweet in our text corpus, plus every election-ish note. */
const notes = new Map<string, DNote>();
const notesByTweet = new Map<string, DNote[]>();
await forEachTsvRow("notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const created = Number(cols[i("createdAtMillis")]);
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;
  const tweetId = cols[i("tweetId")]!;
  const summary = cols[i("summary")] ?? "";
  const tier = topic.matches(summary.toLowerCase()) ? "strict" : BROAD.test(summary) ? "broad" : null;
  // Keep it if it's election-ish OR it lands on a tweet we hold.
  if (!tier && !textById.has(tweetId)) return;
  const n: DNote = { noteId: cols[i("noteId")]!, tweetId, createdAtMillis: created, summary, tier };
  notes.set(n.noteId, n);
  const list = notesByTweet.get(tweetId) ?? [];
  list.push(n);
  notesByTweet.set(tweetId, list);
});

// ── Dump pass 2: statuses ────────────────────────────────────────────────────
await forEachTsvRow("noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const n = notes.get(cols[i("noteId")]!);
  if (!n) return;
  n.status = cols[i("currentStatus")] ?? "";
  const ts = Number(cols[i("timestampMillisOfFirstNonNMRStatus")]);
  if (Number.isFinite(ts) && ts > 0) n.firstStatusMillis = ts;
});

// ── §1 Outcomes on the untreated regular-feed population ─────────────────────
console.log(`\n=== §1 what happened to the topic posts the regular pass handled untreated ===`);
function outcomes(label: string, ids: string[]) {
  const noted = ids.filter((id) => (notesByTweet.get(id) ?? []).length);
  const shown = noted.filter((id) => (notesByTweet.get(id) ?? []).some((n) => n.status === SHOWN));
  const decided = noted.filter((id) => (notesByTweet.get(id) ?? []).some((n) => n.status === SHOWN || n.status === NOT_HELPFUL));
  console.log(`\n${label}: ${ids.length} tweets`);
  console.log(`  noted by someone: ${noted.length} (${pct(noted.length, ids.length)})`);
  console.log(`  reached a decision (Helpful or Not): ${decided.length} (${pct(decided.length, ids.length)})`);
  console.log(`  has a SHOWN note: ${shown.length} (${pct(shown.length, ids.length)})`);
  return { ids, noted, shown, decided };
}
const regular = outcomes("REGULAR-feed topic posts (PR #293's new population)", [...regularIds]);
const xxl = outcomes("XXL-sighted topic posts (the control)", [...sightings]);

console.log(`\n--- the shown-note cases: what the winning note said, on a post we could have taken ---`);
const wins: Array<{ tweetId: string; tweetText: string; note: DNote; hoursToStatus: number | null }> = [];
for (const id of regular.shown) {
  const note = (notesByTweet.get(id) ?? []).find((n) => n.status === SHOWN)!;
  const hrs = note.firstStatusMillis ? (note.firstStatusMillis - note.createdAtMillis) / 3.6e6 : null;
  wins.push({ tweetId: id, tweetText: clean(textById.get(id) ?? ""), note, hoursToStatus: hrs });
}
wins.sort((a, b) => (a.hoursToStatus ?? 1e9) - (b.hoursToStatus ?? 1e9));
for (const w of wins.slice(0, 20)) {
  console.log(`\n  tweet ${w.tweetId}${w.hoursToStatus !== null ? `  (Helpful in ${w.hoursToStatus.toFixed(1)}h)` : ""}`);
  console.log(`    POST: ${w.tweetText.slice(0, 200)}`);
  console.log(`    NOTE: ${clean(w.note.summary).slice(0, 300)}`);
}

// ── §2 Recall of the stage-1 predicate against real tweet text ───────────────
console.log(`\n\n=== §2 stage-1 recall: ecosystem-noted tweets whose text we hold ===`);
const electionNoted = [...notesByTweet.entries()]
  .filter(([id, ns]) => textById.has(id) && ns.some((n) => n.tier))
  .map(([id, ns]) => ({ id, text: textById.get(id)!, notes: ns }));
const hit = electionNoted.filter((t) => topic.matches(t.text.toLowerCase()));
const miss = electionNoted.filter((t) => !topic.matches(t.text.toLowerCase()));
console.log(`${electionNoted.length} tweets carry an election-ish ecosystem note AND we hold their text.`);
console.log(`  stage-1 predicate matches: ${hit.length} (${pct(hit.length, electionNoted.length)})`);
console.log(`  MISSED by stage-1:         ${miss.length} (${pct(miss.length, electionNoted.length)})`);
console.log(`\n--- the misses (each is a keyword gap; note text shows what it was about) ---`);
for (const m of miss.slice(0, 25)) {
  console.log(`\n  ${m.id}`);
  console.log(`    POST: ${clean(m.text).slice(0, 180)}`);
  console.log(`    NOTE: ${clean(m.notes[0]!.summary).slice(0, 180)}`);
}

// ── §3 Anatomy: shown vs not, on this topic ──────────────────────────────────
console.log(`\n\n=== §3 note anatomy on this topic: shown vs not-shown ===`);
const topical = [...notes.values()].filter((n) => n.tier === "strict");
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
const urlsIn = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
function anatomy(label: string, ns: DNote[]) {
  if (!ns.length) return console.log(`\n${label}: none`);
  const lens = ns.map((n) => n.summary.length).sort((a, b) => a - b);
  const withUrl = ns.filter((n) => urlsIn(n.summary).length).length;
  const domains = new Map<string, number>();
  for (const n of ns) for (const u of urlsIn(n.summary)) {
    const d = domainOf(u);
    if (d) domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  console.log(`\n${label}: ${ns.length} notes`);
  console.log(`  median length ${lens[Math.floor(lens.length / 2)]} chars; has a URL ${pct(withUrl, ns.length)}`);
  console.log(`  top source domains: ${[...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, c]) => `${d}(${c})`).join(" ")}`);
}
anatomy("SHOWN (Currently Rated Helpful)", topical.filter((n) => n.status === SHOWN));
anatomy("NOT HELPFUL", topical.filter((n) => n.status === NOT_HELPFUL));
anatomy("never decided (needs more ratings)", topical.filter((n) => n.status !== SHOWN && n.status !== NOT_HELPFUL));

// ── Artifact for the critique pass / dashboard precedent section ─────────────
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/audit.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  regular_feed: { total: regular.ids.length, noted: regular.noted.length, decided: regular.decided.length, shown: regular.shown.length },
  xxl_sighted: { total: xxl.ids.length, noted: xxl.noted.length, decided: xxl.decided.length, shown: xxl.shown.length },
  recall: { held: electionNoted.length, matched: hit.length, missed: miss.length,
            misses: miss.map((m) => ({ tweetId: m.id, text: clean(m.text), note: clean(m.notes[0]!.summary) })) },
  wins: wins.map((w) => ({ tweetId: w.tweetId, tweetText: w.tweetText, note: clean(w.note.summary), hoursToStatus: w.hoursToStatus })),
  topical_by_status: topical.map((n) => ({ noteId: n.noteId, tweetId: n.tweetId, status: n.status,
    summary: clean(n.summary), tweetText: clean(textById.get(n.tweetId) ?? ""),
    hoursToStatus: n.firstStatusMillis ? (n.firstStatusMillis - n.createdAtMillis) / 3.6e6 : null })),
}, null, 2));
console.log(`\nwrote ${OUT_DIR}/audit.json`);

/**
 * Not-Helpful deep dive, analysis 3 (data assembly) — contrast dossiers.
 *
 * Builds dossier.json (gitignored — verbatim tweet/note text) with three
 * groups side by side:
 *
 *  - converters: ecosystem winner notes that flipped OUR hostile bloc —
 *    winners on which raters from the 699-strong NH-only bloc voted
 *    HELPFUL, ranked by bloc-helpful votes. The empirically proven "what
 *    converts a hostile-prior rater" corpus, with the helpful tags those
 *    bloc raters ticked.
 *  - our_rated: all 16 rated notes of ours (wipeouts → relative successes)
 *    with note text, tweet text (from prod), tag profiles, timing.
 *  - winner_tag_profile: what all raters reward across all 57 winners
 *    (the 7/22 five-tag cluster, now at full n).
 *
 *   bun run src/scripts_rob/2026_07_24_not_helpful_deep_dive/dossier_data.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { SupabaseLogger } from "../../api/supabaseClient";
import { forEachTsvRow } from "../dashboard_exports/tsv";

const DIR = import.meta.dir;
const DUMP_DIR = "./cn-data";
const targets = JSON.parse(readFileSync(`${DIR}/targets.json`, "utf8"));
const tagAnalysis = JSON.parse(readFileSync(`${DIR}/tag_analysis.json`, "utf8"));
const ours = new Set<string>(targets.ours);
const winners = new Set(Object.entries(targets.eco as Record<string, { status: string | null }>)
  .filter(([, m]) => m.status === "CURRENTLY_RATED_HELPFUL").map(([id]) => id));

const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const pretty = (tag: string) =>
  tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
const domains = (s: string) => [...s.matchAll(/https?:\/\/([^\/\s]+)/g)].map((m) => m[1]!.replace(/^www\./, ""));

// ── Pass over kept ratings: per-note profiles + NH-bloc membership ──────────
interface NoteAgg { H: number; S: number; N: number; hTags: Map<string, number>; nhTags: Map<string, number> }
const mkAgg = (): NoteAgg => ({ H: 0, S: 0, N: 0, hTags: new Map(), nhTags: new Map() });
interface Vote { noteId: string; rater: string; level: "H" | "S" | "N"; tags: string[] }
const votes: Vote[] = [];
{
  const lines = readFileSync(`${DIR}/target_ratings.tsv`, "utf8").split("\n");
  let h: string[] = [];
  let noteI = -1, raterI = -1, levelI = -1;
  let tagCols: { c: string; i: number }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("HEADER\t")) {
      h = line.split("\t").slice(1);
      noteI = h.indexOf("noteId") + 1;
      raterI = h.indexOf("raterParticipantId") + 1;
      levelI = h.indexOf("helpfulnessLevel") + 1;
      tagCols = h.map((c, i) => ({ c, i: i + 1 })).filter(({ c }) => /^(helpful|notHelpful)[A-Z]/.test(c) && c !== "helpfulnessLevel");
      continue;
    }
    if (!line) continue;
    const c = line.split("\t");
    const key = `${c[noteI]}:${c[raterI]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lv = c[levelI];
    const level = lv === "HELPFUL" ? "H" : lv === "SOMEWHAT_HELPFUL" ? "S" : lv === "NOT_HELPFUL" ? "N" : null;
    if (!level) continue;
    votes.push({ noteId: c[noteI]!, rater: c[raterI]!, level, tags: tagCols.filter(({ i }) => c[i] === "1").map(({ c }) => c) });
  }
}

const oursByRater = new Map<string, { H: number; N: number }>();
for (const v of votes) {
  if (!ours.has(v.noteId)) continue;
  const t = oursByRater.get(v.rater) ?? { H: 0, N: 0 };
  if (v.level === "H") t.H++;
  if (v.level === "N") t.N++;
  oursByRater.set(v.rater, t);
}
const nhBloc = new Set([...oursByRater.entries()].filter(([, t]) => t.N > 0 && t.H === 0).map(([r]) => r));

// Winner profiles: overall + bloc-specific.
const winnerAgg = new Map<string, NoteAgg>();
const blocOnWinner = new Map<string, { H: number; N: number; hTags: Map<string, number> }>();
const winnerTagProfile = mkAgg();
for (const v of votes) {
  if (!winners.has(v.noteId)) continue;
  const a = winnerAgg.get(v.noteId) ?? mkAgg();
  a[v.level]++;
  winnerTagProfile[v.level]++;
  for (const t of v.tags) {
    const m = t.startsWith("notHelpful") ? a.nhTags : a.hTags;
    m.set(t, (m.get(t) ?? 0) + 1);
    const g = t.startsWith("notHelpful") ? winnerTagProfile.nhTags : winnerTagProfile.hTags;
    g.set(t, (g.get(t) ?? 0) + 1);
  }
  winnerAgg.set(v.noteId, a);
  if (nhBloc.has(v.rater)) {
    const b = blocOnWinner.get(v.noteId) ?? { H: 0, N: 0, hTags: new Map() };
    if (v.level === "H") {
      b.H++;
      for (const t of v.tags) if (t.startsWith("helpful")) b.hTags.set(t, (b.hTags.get(t) ?? 0) + 1);
    }
    if (v.level === "N") b.N++;
    blocOnWinner.set(v.noteId, b);
  }
}

// ── Winner metadata from the local dump ──────────────────────────────────────
interface WinnerMeta { tweetId: string; createdAtMillis: number; summary: string }
const winnerMeta = new Map<string, WinnerMeta>();
await forEachTsvRow(DUMP_DIR, "notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const id = cols[i("noteId")]!;
  if (!winners.has(id)) return;
  winnerMeta.set(id, {
    tweetId: cols[i("tweetId")]!,
    createdAtMillis: Number(cols[i("createdAtMillis")]),
    summary: (cols[i("summary")] ?? "").replace(/\s+/g, " ").trim(),
  });
});
const hoursToHelpful = new Map<string, number>();
await forEachTsvRow(DUMP_DIR, "noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const id = cols[i("noteId")]!;
  if (!winners.has(id)) return;
  if (cols[i("firstNonNMRStatus")] !== "CURRENTLY_RATED_HELPFUL") return;
  const first = Number(cols[i("timestampMillisOfFirstNonNMRStatus")]);
  const created = winnerMeta.get(id)?.createdAtMillis;
  if (Number.isFinite(first) && first > 0 && created)
    hoursToHelpful.set(id, Number(((first - created) / 3.6e6).toFixed(1)));
});

// ── Our rated notes from prod (note + tweet text) ────────────────────────────
const perNote: any[] = tagAnalysis.per_note.filter((n: any) => n.helpful + n.somewhat + n.not_helpful > 0);
const ourIds = perNote.map((n) => n.note_id);
const noteRows: { note_id: string; tweet_id: string; note_text: string | null; submitted_at: string | null }[] = [];
for (const ids of chunk(ourIds, 100)) {
  noteRows.push(...await logger.fetchAllRows<(typeof noteRows)[number]>(
    (c) => c.from("notes").select("note_id, tweet_id, note_text, submitted_at").in("note_id", ids), "note_id"));
}
const tweetRows: { tweet_id: string; text: string | null; posted_at: string | null }[] = [];
for (const ids of chunk([...new Set(noteRows.map((n) => n.tweet_id))], 100)) {
  tweetRows.push(...await logger.fetchAllRows<(typeof tweetRows)[number]>(
    (c) => c.from("tweets").select("tweet_id, text, posted_at").in("tweet_id", ids), "tweet_id"));
}
const tweetById = new Map(tweetRows.map((t) => [t.tweet_id, t]));
const noteById = new Map(noteRows.map((n) => [n.note_id, n]));

const fmtTags = (m: Map<string, number> | Record<string, number>, prefix: string) =>
  Object.fromEntries([...(m instanceof Map ? m.entries() : Object.entries(m))]
    .filter(([t]) => t.startsWith(prefix)).sort((a, b) => b[1] - a[1]).map(([t, n]) => [pretty(t), n]));

// ── Assemble ────────────────────────────────────────────────────────────────
const converters = [...blocOnWinner.entries()]
  .filter(([, b]) => b.H > 0)
  .sort((a, b) => b[1].H - a[1].H)
  .map(([id, b]) => {
    const m = winnerMeta.get(id);
    const a = winnerAgg.get(id);
    return {
      note_id: id,
      tweet_url: m ? `https://x.com/i/web/status/${m.tweetId}` : null,
      created_at: m ? new Date(m.createdAtMillis).toISOString() : null,
      hours_to_helpful: hoursToHelpful.get(id) ?? null,
      note_text: m?.summary ?? null,
      chars: m?.summary.length ?? null,
      source_domains: m ? domains(m.summary) : [],
      ratings_all: a ? { helpful: a.H, somewhat: a.S, not_helpful: a.N } : null,
      bloc_votes: { helpful: b.H, not_helpful: b.N },
      bloc_helpful_tags: fmtTags(b.hTags, "helpful"),
      top_nh_tags_all: a ? fmtTags(a.nhTags, "notHelpful") : {},
    };
  });

const ourRated = perNote
  .sort((a: any, b: any) => (b.helpful / Math.max(1, b.helpful + b.not_helpful)) - (a.helpful / Math.max(1, a.helpful + a.not_helpful)))
  .map((n: any) => {
    const note = noteById.get(n.note_id);
    const tweet = note ? tweetById.get(note.tweet_id) : null;
    return {
      note_id: n.note_id,
      submitted_at: n.submitted_at,
      cohort: n.cohort,
      tweet_url: note ? `https://x.com/i/web/status/${note.tweet_id}` : null,
      tweet_text: tweet?.text ?? null,
      tweet_created_at: tweet?.posted_at ?? null,
      note_text: note?.note_text ?? null,
      chars: note?.note_text?.length ?? null,
      source_domains: note?.note_text ? domains(note.note_text) : [],
      ratings: { helpful: n.helpful, somewhat: n.somewhat, not_helpful: n.not_helpful },
      top_nh_tags: n.top_not_helpful_tags,
    };
  });

const out = {
  generated_at: new Date().toISOString(),
  nh_bloc_size: nhBloc.size,
  converters,
  our_rated: ourRated,
  winner_tag_profile: {
    votes: { helpful: winnerTagProfile.H, somewhat: winnerTagProfile.S, not_helpful: winnerTagProfile.N },
    helpful_tags: fmtTags(winnerTagProfile.hTags, "helpful"),
    not_helpful_tags: fmtTags(winnerTagProfile.nhTags, "notHelpful"),
  },
};
writeFileSync(`${DIR}/dossier.json`, JSON.stringify(out, null, 2));
console.log(`→ ${DIR}/dossier.json\n`);
console.log(`converters (winners with ≥1 bloc-helpful vote): ${converters.length}`);
for (const c of converters.slice(0, 12)) {
  console.log(`  bloc ${c.bloc_votes.helpful}H/${c.bloc_votes.not_helpful}N  all ${c.ratings_all?.helpful}/${c.ratings_all?.somewhat}/${c.ratings_all?.not_helpful}  ` +
    `${c.hours_to_helpful ?? "?"}h  ${c.chars}ch  [${c.source_domains.join(", ")}]  ${(c.note_text ?? "").slice(0, 90)}…`);
}
console.log(`\nwinner tag profile (all 57 winners): ${JSON.stringify(out.winner_tag_profile.votes)}`);

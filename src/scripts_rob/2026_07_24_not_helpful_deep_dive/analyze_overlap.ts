/**
 * Not-Helpful deep dive, analysis 2 (the crux) — rater overlap.
 *
 * Question: the raters who voted our topic notes Not Helpful — are they
 * persuadable raters who rejected OUR notes specifically (they vote Helpful
 * on ecosystem election winners), or a wall that rejects every note in this
 * domain? Decides "it's the notes" vs "it's the audience".
 *
 * Inputs: targets.json + target_ratings.tsv from collect_ratings.ts
 * (partition 00000 verified complete for all target notes: our 937 rows
 * exactly match note_ratings_from_public_dump, 57/57 winners covered).
 *
 *   bun run src/scripts_rob/2026_07_24_not_helpful_deep_dive/analyze_overlap.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const DIR = import.meta.dir;
const targets = JSON.parse(readFileSync(`${DIR}/targets.json`, "utf8"));
const ours = new Set<string>(targets.ours);
const ecoMeta: Record<string, { tier: "strict" | "broad"; status: string | null }> = targets.eco;
const winners = new Set(Object.entries(ecoMeta).filter(([, m]) => m.status === "CURRENTLY_RATED_HELPFUL").map(([id]) => id));
const ecoLosers = new Set(Object.entries(ecoMeta).filter(([, m]) => m.status === "CURRENTLY_RATED_NOT_HELPFUL").map(([id]) => id));

// ── Load + dedupe ratings ────────────────────────────────────────────────────
type Level = "H" | "S" | "N";
interface Rating { noteId: string; rater: string; level: Level }
const ratings: Rating[] = [];
{
  const lines = readFileSync(`${DIR}/target_ratings.tsv`, "utf8").split("\n");
  let noteI = -1, raterI = -1, levelI = -1;
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("HEADER\t")) {
      const h = line.split("\t").slice(1);
      noteI = h.indexOf("noteId") + 1;
      raterI = h.indexOf("raterParticipantId") + 1;
      levelI = h.indexOf("helpfulnessLevel") + 1;
      continue;
    }
    if (!line) continue;
    const c = line.split("\t");
    const key = `${c[noteI]}:${c[raterI]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lv = c[levelI];
    const level: Level | null = lv === "HELPFUL" ? "H" : lv === "SOMEWHAT_HELPFUL" ? "S" : lv === "NOT_HELPFUL" ? "N" : null;
    if (!level) continue;
    ratings.push({ noteId: c[noteI]!, rater: c[raterI]!, level });
  }
}
console.log(`${ratings.length} deduped ratings loaded`);

// ── Per-rater profile ────────────────────────────────────────────────────────
interface Counts { H: number; S: number; N: number }
const mk = (): Counts => ({ H: 0, S: 0, N: 0 });
interface Profile {
  onOurs: Counts; onWinners: Counts; onEcoLosers: Counts; onEcoUndecided: Counts;
}
const profiles = new Map<string, Profile>();
const prof = (r: string) => {
  let p = profiles.get(r);
  if (!p) { p = { onOurs: mk(), onWinners: mk(), onEcoLosers: mk(), onEcoUndecided: mk() }; profiles.set(r, p); }
  return p;
};
// Winner approval base rate across ALL raters in the kept data (control).
const winnerAll = mk();
const ecoUndecidedAll = mk();
for (const r of ratings) {
  const p = prof(r.rater);
  if (ours.has(r.noteId)) p.onOurs[r.level]++;
  else if (winners.has(r.noteId)) { p.onWinners[r.level]++; winnerAll[r.level]++; }
  else if (ecoLosers.has(r.noteId)) p.onEcoLosers[r.level]++;
  else { p.onEcoUndecided[r.level]++; ecoUndecidedAll[r.level]++; }
}

const ourRaters = [...profiles.entries()].filter(([, p]) => p.onOurs.H + p.onOurs.S + p.onOurs.N > 0);
const nhRaters = ourRaters.filter(([, p]) => p.onOurs.N > 0 && p.onOurs.H === 0);
const hRaters = ourRaters.filter(([, p]) => p.onOurs.H > 0 && p.onOurs.N === 0);
const mixedRaters = ourRaters.filter(([, p]) => p.onOurs.H > 0 && p.onOurs.N > 0);

const pct = (a: number, b: number) => (b ? Number(((100 * a) / b).toFixed(1)) : null);
const sum = (c: Counts) => c.H + c.S + c.N;

// ── The verdict cut: our-NH raters' behavior on winners ─────────────────────
function group(label: string, rs: [string, Profile][]) {
  const withWinnerVotes = rs.filter(([, p]) => sum(p.onWinners) > 0);
  const helpfulOnAnyWinner = withWinnerVotes.filter(([, p]) => p.onWinners.H > 0);
  const winnerVotes = mk();
  const ecoVotes = mk();
  for (const [, p] of rs) {
    winnerVotes.H += p.onWinners.H; winnerVotes.S += p.onWinners.S; winnerVotes.N += p.onWinners.N;
    for (const k of ["H", "S", "N"] as const) ecoVotes[k] += p.onWinners[k] + p.onEcoLosers[k] + p.onEcoUndecided[k];
  }
  return {
    label,
    raters: rs.length,
    rated_any_winner: withWinnerVotes.length,
    rated_any_winner_pct: pct(withWinnerVotes.length, rs.length),
    helpful_on_some_winner: helpfulOnAnyWinner.length,
    helpful_on_some_winner_pct_of_overlap: pct(helpfulOnAnyWinner.length, withWinnerVotes.length),
    votes_on_winners: winnerVotes,
    winner_helpful_rate: pct(winnerVotes.H, sum(winnerVotes)),
    votes_on_all_eco: ecoVotes,
    eco_nh_rate: pct(ecoVotes.N, sum(ecoVotes)),
  };
}

const result = {
  generated_at: new Date().toISOString(),
  populations: {
    our_rated_notes: [...ours].length,
    our_raters_total: ourRaters.length,
    nh_only_raters: nhRaters.length,
    h_only_raters: hRaters.length,
    mixed_raters: mixedRaters.length,
  },
  controls: {
    winner_helpful_rate_all_kept_raters: pct(winnerAll.H, sum(winnerAll)),
    winner_votes_all: winnerAll,
    eco_undecided_nh_rate_all: pct(ecoUndecidedAll.N, sum(ecoUndecidedAll)),
  },
  groups: [
    group("voted ours NOT_HELPFUL (never helpful)", nhRaters),
    group("voted ours HELPFUL (never NH)", hRaters),
    group("mixed on ours", mixedRaters),
  ],
};
writeFileSync(`${DIR}/overlap.json`, JSON.stringify(result, null, 2));
console.log(`→ ${DIR}/overlap.json\n`);

console.log(`our raters: ${ourRaters.length} (${nhRaters.length} NH-only, ${hRaters.length} H-only, ${mixedRaters.length} mixed)`);
console.log(`control: winner helpful-rate across all kept raters = ${result.controls.winner_helpful_rate_all_kept_raters}% ` +
  `(${winnerAll.H}/${sum(winnerAll)})\n`);
for (const g of result.groups) {
  console.log(`== ${g.label} (${g.raters} raters) ==`);
  console.log(`  rated ≥1 winner: ${g.rated_any_winner} (${g.rated_any_winner_pct}%)`);
  console.log(`  of those, Helpful on ≥1 winner: ${g.helpful_on_some_winner} (${g.helpful_on_some_winner_pct_of_overlap}%)`);
  console.log(`  vote mix on winners: ${g.votes_on_winners.H}/${g.votes_on_winners.S}/${g.votes_on_winners.N} ` +
    `(helpful rate ${g.winner_helpful_rate}%)`);
  console.log(`  vote mix on ALL eco election notes: ${g.votes_on_all_eco.H}/${g.votes_on_all_eco.S}/${g.votes_on_all_eco.N} ` +
    `(NH rate ${g.eco_nh_rate}%)\n`);
}

/* Scores the note judge's runs against the labels (GOO-588) and writes
 * data/report.md.
 *
 * For P(helpful) it reports, for each set of notes:
 * - AUC, the chance that a random helpful note gets a higher p_helpful than a
 *   random not-helpful note. 0.5 is guessing and 1 is a perfect ranking. The
 *   95% interval comes from resampling the notes (bootstrap).
 * - The Brier score, the mean squared error of the probability. Lower is
 *   better. Next to it is the Brier score of always guessing the share of
 *   helpful notes in the set, which is the score to beat.
 * - A calibration table: per range of p_helpful, how many notes really were
 *   helpful.
 * P(impactful) has almost no ground truth yet, so the report only lists the
 * notes the judge ranked highest.
 *
 * Usage: bun run src/scripts_jim/2026_10_26_note_judge/score.ts */

import { writeFileSync } from "fs";
import * as path from "path";
import { DATA_DIR, readDataset, readResults, splitForMode, type JudgeResult, type LabelledNote, type Mode } from "./dataFiles";

const BOOTSTRAP_SAMPLES = 2000;
const CALIBRATION_BINS = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
const TOP_IMPACTFUL = 10;
const NOTE_PREVIEW_CHARS = 160;

type Scored = { p: number; helpful: boolean };

function auc(rows: Scored[]): number {
  const positives = rows.filter((r) => r.helpful);
  const negatives = rows.filter((r) => !r.helpful);
  let wins = 0;
  for (const pos of positives) for (const neg of negatives) wins += pos.p > neg.p ? 1 : pos.p === neg.p ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

const brier = (rows: Scored[], p = (r: Scored) => r.p) => rows.reduce((sum, r) => sum + (p(r) - Number(r.helpful)) ** 2, 0) / rows.length;

/** A fixed seed, so the interval is the same every time the report is built. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

function aucInterval(rows: Scored[]): [number, number] {
  const random = seededRandom(1);
  const samples: number[] = [];
  while (samples.length < BOOTSTRAP_SAMPLES) {
    const sample = rows.map(() => rows[Math.floor(random() * rows.length)]);
    if (sample.some((r) => r.helpful) && sample.some((r) => !r.helpful)) samples.push(auc(sample));
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(0.025 * samples.length)], samples[Math.floor(0.975 * samples.length)]];
}

/** One set of notes, scored against one run. The page's Results section reads
 *  these from report.json. */
export interface SetScore {
  title: string;
  notes: number;
  judged: number;
  helpful: number;
  notHelpful: number;
  auc: number;
  aucInterval: [number, number];
  brier: number;
  baselineBrier: number;
  meanPHelpful: { helpful: number; notHelpful: number };
  calibration: { low: number; high: number; notes: number; helpful: number }[];
}

function calibration(rows: Scored[]): SetScore["calibration"] {
  return CALIBRATION_BINS.slice(0, -1).flatMap((low, i) => {
    const high = Math.min(CALIBRATION_BINS[i + 1], 1);
    const inBin = rows.filter((r) => r.p >= low && r.p < CALIBRATION_BINS[i + 1]);
    return inBin.length === 0 ? [] : [{ low, high, notes: inBin.length, helpful: inBin.filter((r) => r.helpful).length }];
  });
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function scoreSet(title: string, notes: LabelledNote[], results: JudgeResult[]): SetScore | null {
  const byDraft = new Map(results.map((r) => [r.draftId, r]));
  const rows: Scored[] = notes.flatMap((n) => {
    const r = byDraft.get(n.draftId);
    return r ? [{ p: r.pHelpful, helpful: n.outcome === "helpful" }] : [];
  });
  if (rows.length === 0) return null;
  const helpfulShare = rows.filter((r) => r.helpful).length / rows.length;
  return {
    title,
    notes: notes.length,
    judged: rows.length,
    helpful: rows.filter((r) => r.helpful).length,
    notHelpful: rows.filter((r) => !r.helpful).length,
    auc: auc(rows),
    aucInterval: aucInterval(rows),
    brier: brier(rows),
    baselineBrier: brier(rows, () => helpfulShare),
    meanPHelpful: { helpful: mean(rows.filter((r) => r.helpful).map((r) => r.p)), notHelpful: mean(rows.filter((r) => !r.helpful).map((r) => r.p)) },
    calibration: calibration(rows),
  };
}

function setMarkdown(title: string, score: SetScore | null): string {
  if (!score) return `## ${title}\n\nNo results yet.`;
  const bins = score.calibration.map((b) => `| ${b.low.toFixed(1)} to ${b.high.toFixed(1)} | ${b.notes} | ${b.helpful} (${Math.round((100 * b.helpful) / b.notes)}%) |`);
  return [
    `## ${title}`,
    "",
    `${score.judged} of ${score.notes} notes judged: ${score.helpful} helpful, ${score.notHelpful} not helpful.`,
    "",
    `- AUC: ${score.auc.toFixed(2)} (95% interval ${score.aucInterval[0].toFixed(2)} to ${score.aucInterval[1].toFixed(2)})`,
    `- Brier score: ${score.brier.toFixed(3)}. Always guessing the share of helpful notes scores ${score.baselineBrier.toFixed(3)}.`,
    `- Mean p_helpful: ${score.meanPHelpful.helpful.toFixed(2)} on helpful notes, ${score.meanPHelpful.notHelpful.toFixed(2)} on not-helpful notes.`,
    "",
    "| p_helpful | Notes | Really helpful |",
    "|---|---|---|",
    ...bins,
  ].join("\n");
}

function impactfulSection(dataset: LabelledNote[], results: JudgeResult[]): string {
  const noteById = new Map(dataset.map((n) => [n.draftId, n]));
  const top = [...results].sort((a, b) => b.pImpactful - a.pImpactful).slice(0, TOP_IMPACTFUL);
  const lines = top.map((r) => {
    const n = noteById.get(r.draftId)!;
    const preview = n.note.replace(/\s+/g, " ").slice(0, NOTE_PREVIEW_CHARS);
    return `- ${r.pImpactful.toFixed(2)}${n.onLeaderboard ? " (on the leaderboard)" : ""}: ${preview}`;
  });
  const onBoard = dataset.filter((n) => n.onLeaderboard).map((n) => results.find((r) => r.draftId === n.draftId)?.pImpactful.toFixed(2) ?? "not judged");
  return [
    "## P(impactful), zero-shot",
    "",
    `Notes on the leaderboard and their p_impactful: ${onBoard.join(", ") || "none in the labelled set"}.`,
    "",
    `The ${TOP_IMPACTFUL} notes with the highest p_impactful:`,
    "",
    ...lines,
  ].join("\n");
}

function runCost(results: JudgeResult[]) {
  return {
    judges: results.length,
    usd: results.reduce((sum, r) => sum + r.costUsd, 0),
    minutesEach: results.length === 0 ? 0 : results.reduce((sum, r) => sum + r.seconds, 0) / results.length / 60,
  };
}

const dataset = readDataset();
const zero = readResults("zero");
const few = readResults("few");
const newerHalf = splitForMode(dataset, "few").targets;
const sets: [string, LabelledNote[], JudgeResult[]][] = [
  ["Experiment 1, zero-shot, every labelled note", dataset, zero],
  ["Experiment 1, zero-shot, the newer half", newerHalf, zero],
  ["Experiment 2, few-shot, the newer half", newerHalf, few],
];
const scores = sets.map(([title, notes, results]) => ({ title, score: scoreSet(title, notes, results) }));
const cost = { zero: runCost(zero), few: runCost(few) };
const costLine = (mode: Mode) => `- ${mode}: ${cost[mode].judges} judges, $${cost[mode].usd.toFixed(2)} at API prices, ${cost[mode].minutesEach.toFixed(1)} minutes each on average`;
const report = [
  "# Note judge experiment",
  ...scores.map(({ title, score }) => setMarkdown(title, score)),
  impactfulSection(dataset, zero),
  ["## Cost", "", costLine("zero"), costLine("few")].join("\n"),
].join("\n\n");
writeFileSync(path.join(DATA_DIR, "report.md"), report + "\n");
writeFileSync(path.join(DATA_DIR, "report.json"), JSON.stringify({ sets: scores.flatMap(({ score }) => (score ? [score] : [])), cost }, null, 1));
console.log(report);

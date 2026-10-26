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

function calibrationTable(rows: Scored[]): string {
  const lines = ["| p_helpful | Notes | Really helpful |", "|---|---|---|"];
  for (let i = 0; i < CALIBRATION_BINS.length - 1; i++) {
    const [low, high] = [CALIBRATION_BINS[i], CALIBRATION_BINS[i + 1]];
    const inBin = rows.filter((r) => r.p >= low && r.p < high);
    if (inBin.length === 0) continue;
    const helpful = inBin.filter((r) => r.helpful).length;
    lines.push(`| ${low.toFixed(1)} to ${Math.min(high, 1).toFixed(1)} | ${inBin.length} | ${helpful} (${Math.round((100 * helpful) / inBin.length)}%) |`);
  }
  return lines.join("\n");
}

function scoreSection(title: string, notes: LabelledNote[], results: JudgeResult[]): string {
  const byDraft = new Map(results.map((r) => [r.draftId, r]));
  const rows: Scored[] = notes.flatMap((n) => {
    const r = byDraft.get(n.draftId);
    return r ? [{ p: r.pHelpful, helpful: n.outcome === "helpful" }] : [];
  });
  if (rows.length === 0) return `## ${title}\n\nNo results yet.`;
  const helpfulShare = rows.filter((r) => r.helpful).length / rows.length;
  const [low, high] = aucInterval(rows);
  const mean = (helpful: boolean) => {
    const ps = rows.filter((r) => r.helpful === helpful).map((r) => r.p);
    return (ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(2);
  };
  return [
    `## ${title}`,
    "",
    `${rows.length} of ${notes.length} notes judged: ${rows.filter((r) => r.helpful).length} helpful, ${rows.filter((r) => !r.helpful).length} not helpful.`,
    "",
    `- AUC: ${auc(rows).toFixed(2)} (95% interval ${low.toFixed(2)} to ${high.toFixed(2)})`,
    `- Brier score: ${brier(rows).toFixed(3)}. Always guessing ${helpfulShare.toFixed(2)} scores ${brier(rows, () => helpfulShare).toFixed(3)}.`,
    `- Mean p_helpful: ${mean(true)} on helpful notes, ${mean(false)} on not-helpful notes.`,
    "",
    calibrationTable(rows),
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

function costLine(mode: Mode, results: JudgeResult[]): string {
  if (results.length === 0) return `- ${mode}: no results`;
  const cost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const minutes = results.reduce((sum, r) => sum + r.seconds, 0) / results.length / 60;
  return `- ${mode}: ${results.length} judges, $${cost.toFixed(2)} at API prices, ${minutes.toFixed(1)} minutes each on average`;
}

const dataset = readDataset();
const zero = readResults("zero");
const few = readResults("few");
const newerHalf = splitForMode(dataset, "few").targets;
const report = [
  "# Note judge experiment",
  scoreSection("P(helpful), zero-shot, every labelled note", dataset, zero),
  scoreSection("P(helpful), zero-shot, the newer half", newerHalf, zero),
  scoreSection("P(helpful), few-shot, the newer half", newerHalf, few),
  impactfulSection(dataset, zero),
  ["## Cost", "", costLine("zero", zero), costLine("few", few)].join("\n"),
].join("\n\n");
writeFileSync(path.join(DATA_DIR, "report.md"), report + "\n");
console.log(report);

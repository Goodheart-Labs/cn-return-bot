/* The experiment's data files in data/, which git ignores: dataset.json with
 * the labelled notes, and one <mode>.jsonl per run with the judges' answers. */

import { existsSync, readFileSync } from "fs";
import * as path from "path";
import type { JudgeExample } from "./judge";

export const DATA_DIR = new URL("./data/", import.meta.url).pathname;
export const DATASET_PATH = path.join(DATA_DIR, "dataset.json");

export interface LabelledNote extends JudgeExample {
  draftId: string;
  noteId: string | null;
  createdAt: string;
  /** Which part of the rule gave the label, for reading the results. */
  labelWhy: string;
  onLeaderboard: boolean;
}

export type Mode = "zero" | "few";

export interface JudgeResult {
  draftId: string;
  mode: Mode;
  pHelpful: number;
  pImpactful: number;
  reasoning: string;
  costUsd: number;
  turns: number;
  seconds: number;
}

export const resultsPath = (mode: Mode) => path.join(DATA_DIR, `${mode}.jsonl`);

/** The labelled notes, oldest first. */
export const readDataset = (): LabelledNote[] => JSON.parse(readFileSync(DATASET_PATH, "utf8"));

export function readResults(mode: Mode): JudgeResult[] {
  if (!existsSync(resultsPath(mode))) return [];
  return readFileSync(resultsPath(mode), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** The examples the judge sees, and the notes it judges. The few-shot run
 *  shows the older half, by the time the notes were written, and judges the
 *  newer half. */
export function splitForMode(dataset: LabelledNote[], mode: Mode): { examples: LabelledNote[]; targets: LabelledNote[] } {
  if (mode === "zero") return { examples: [], targets: dataset };
  const half = Math.floor(dataset.length / 2);
  return { examples: dataset.slice(0, half), targets: dataset.slice(half) };
}

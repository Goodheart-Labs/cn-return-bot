/* The experiment's data files in data/, which git ignores: dataset.json with
 * the labelled notes, and one <mode>.jsonl per run with the judges' answers. */

import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { shuffled, type JudgeExample } from "../../claude-notes/judge";

export const DATA_DIR = new URL("./data/", import.meta.url).pathname;
export const DATASET_PATH = path.join(DATA_DIR, "dataset.json");

export interface LabelledNote extends JudgeExample {
  noteId: string | null;
  createdAt: string;
  /** Which part of the rule gave the label, for reading the results. */
  labelWhy: string;
  onLeaderboard: boolean;
  /** In the few-shot run, the older half of the notes, by the time they were
   *  written, are examples in the prompt, and the newer half is judged. */
  fewShotRole: "example" | "judged";
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

/** The seed of the examples' order, so every run and every judge sees the
 *  same order. */
const EXAMPLE_ORDER_SEED = 563;

/** The examples the judge sees, and the notes it judges. The examples come in
 *  a fixed shuffled order. In the order they were written, all eleven oldest
 *  were rejections and the last thirteen nearly all helpful, which may have
 *  pushed the few-shot judge towards helpful. */
export function splitForMode(dataset: LabelledNote[], mode: Mode): { examples: LabelledNote[]; targets: LabelledNote[] } {
  if (mode === "zero") return { examples: [], targets: dataset };
  return {
    examples: shuffled(dataset.filter((n) => n.fewShotRole === "example"), EXAMPLE_ORDER_SEED),
    targets: dataset.filter((n) => n.fewShotRole === "judged"),
  };
}

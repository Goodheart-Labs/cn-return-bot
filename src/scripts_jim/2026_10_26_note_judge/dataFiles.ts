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

/** The same random order every time, from a seeded generator (mulberry32). */
function shuffled<T>(items: T[], seed: number): T[] {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

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

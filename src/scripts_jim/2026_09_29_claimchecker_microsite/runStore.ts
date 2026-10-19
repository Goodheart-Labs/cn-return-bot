/**
 * Where the claimchecker lab keeps its files, and the reads and writes the
 * scripts share. The microsite never imports this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { indexEntryOf, type Article, type LabRun, type RunIndexEntry } from "./labRun";

export const LAB_DIR = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = join(LAB_DIR, "site", "public");
export const ARTICLE_PATH = join(PUBLIC_DIR, "article.json");
export const RUNS_DIR = join(PUBLIC_DIR, "runs");
export const RUN_INDEX_PATH = join(RUNS_DIR, "index.json");
/** The intermediate results of each run, which a later run can reuse. */
export const STAGES_DIR = join(LAB_DIR, "stages");
/** The full tweet log of every claim check. They are large, so they stay out
 *  of git. The repository's .gitignore already ignores every `logs` folder. */
export const LOGS_DIR = join(LAB_DIR, "logs");

function readRunIndex(): RunIndexEntry[] {
  return existsSync(RUN_INDEX_PATH) ? JSON.parse(readFileSync(RUN_INDEX_PATH, "utf8")) : [];
}

/** Writes the run's file and puts it into the picker's index, replacing an
 *  earlier entry with the same id. */
export function saveRun(run: LabRun): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 1));
  const index = [...readRunIndex().filter((entry) => entry.id !== run.id), indexEntryOf(run)];
  index.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(RUN_INDEX_PATH, JSON.stringify(index, null, 1));
}

export function readArticle(): Article {
  return JSON.parse(readFileSync(ARTICLE_PATH, "utf8"));
}

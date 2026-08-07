/**
 * A cache of the writer's output on disk, used to replay a pipeline run. It
 * saves everything the gates need, keyed by tweet id. The gates are the
 * note-needed judge and the source verifier. With the cache in place a run can
 * replay just the gates and skip the search and the note writer. The simple
 * bot, the cheap bot, and the seedReplayFromDb tooling all use it.
 *
 * The WRITER_CACHE environment variable turns the cache on, and its value is
 * the path to the cache directory. When the variable is unset nothing is read
 * or written and the full pipeline runs. When the cache already holds an entry
 * for the tweet, the run starts at the gates.
 */
import * as fs from "fs";
import * as path from "path";
import type { PipelineOutcome } from "../../bots/types";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, ANALYSIS_LOG_MAX_CHARS } from "../utils/noteWriterSteps";

const CACHE_ENV = "WRITER_CACHE";

/** The part of a search result we keep, which is its title and its snippet. The
 *  verifier falls back to it when it cannot fetch a source. Live search output
 *  and the cache both use this type. */
export type Snippet = { title: string; snippet: string };

/**
 * The result of the stages that run before the gates. There are two cases.
 * In the early_exit case the pipeline stopped before the writer produced a
 * note, and the stored outcome can be replayed word for word with no LLM call
 * at all. In the writer_done case the writer produced a note and the gates
 * still need to run on it.
 */
export type WriterStageResult =
  | { kind: "early_exit"; outcome: PipelineOutcome }
  | {
      kind: "writer_done";
      userMessage: string;
      findings: string;
      queries: string[];
      noteText: string;
      sources: string[];
      /** The entries of the snippetsByUrl map, serialized. The verifier uses
       *  them when it cannot fetch a source. */
      snippets: [string, Snippet][];
    };

function cacheDir(): string | null {
  return process.env[CACHE_ENV] || null;
}

export function readWriterCache(tweetId: string): WriterStageResult | null {
  const dir = cacheDir();
  if (!dir) return null;
  const p = path.join(dir, `${tweetId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(p, "utf8")) as { stage: WriterStageResult };
    return c.stage;
  } catch {
    return null;
  }
}

export function writeWriterCache(tweetId: string, stage: WriterStageResult): void {
  const dir = cacheDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const payload = { tweetId, cached_at: new Date().toISOString(), stage };
  fs.writeFileSync(path.join(dir, `${tweetId}.json`), JSON.stringify(payload, null, 2));
}

/** Reads the writer stage from the cache, or produces it. On a cache hit it
 *  restores the writer-stage logs that the result categorizer and the dashboard
 *  expect, then returns the cached stage. On a miss it runs `produce`, saves the
 *  result, and returns it. Saving does nothing when WRITER_CACHE is unset. */
export async function withWriterCache(
  tweetId: string,
  produce: () => Promise<WriterStageResult>,
): Promise<WriterStageResult> {
  const cached = readWriterCache(tweetId);
  if (cached) {
    getTweetLog()?.set(`${STEP.noteWriter}.cacheHit`, true);
    restoreWriterLogs(cached);
    return cached;
  }
  const stage = await produce();
  writeWriterCache(tweetId, stage);
  return stage;
}

/** On a cache replay the stages before the gates never run, so nothing writes
 *  their log entries. This writes the queries and the writer's note back into
 *  the log, because the result categorizer and the dashboard both expect to
 *  find them. The categorizer reads them in extractProposedNote and
 *  inferStageBlock. */
export function restoreWriterLogs(stage: WriterStageResult): void {
  if (stage.kind !== "writer_done") return;
  const log = getTweetLog();
  log?.set(`${STEP.queryWriter}.queries`, stage.queries);
  log?.set(`${STEP.searchAnalyzer}.messages.1`, { content: stage.findings.slice(0, ANALYSIS_LOG_MAX_CHARS) });
  log?.set(`${STEP.noteWriter}.attempts.0.response`, { note_text: stage.noteText, sources: stage.sources });
}

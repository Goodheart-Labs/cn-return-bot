/**
 * Disk-backed writer-output cache for pipeline replay. Saves everything the
 * gates (note-needed judge + source verifier) need, keyed by tweet id, so a run
 * can replay just the gates without re-running search and the note writer.
 * Shared by simple-bot, cheap-bot, and the seedReplayFromDb tooling.
 *
 * Gated by the WRITER_CACHE env var (path to a directory). Unset = no caching
 * (full pipeline, no read/write). On a populated cache, a run starts "from the
 * gates".
 */
import * as fs from "fs";
import * as path from "path";
import type { PipelineOutcome } from "../../bots/types";
import { getTweetLog } from "../utils/tweetLog";
import { STEP, ANALYSIS_LOG_MAX_CHARS } from "../utils/noteWriterSteps";

const CACHE_ENV = "WRITER_CACHE";

/** A search-result projection (title + snippet) kept for the verifier's
 *  fetch fallback. Shared between live search output and the cache. */
export type Snippet = { title: string; snippet: string };

/**
 * Result of the pre-gate stages. Either the pipeline terminated before the
 * writer produced a note (early_exit, replayable verbatim with no LLM calls),
 * or the writer produced a note and the gates still need to run (writer_done).
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
      /** Serialized snippetsByUrl Map entries (verifier fetch fallback). */
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

/** Read-or-produce wrapper for the writer stage. On a cache hit, restore the
 *  writer-stage logs the result categorizer + dashboard expect, then return the
 *  cached stage. On a miss (or unset env), run `produce`, persist it (no-op when
 *  the env is unset), and return it. */
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

/** On a cache replay, the pre-gate stages don't run, so re-log the queries +
 *  writer note that the result categorizer (extractProposedNote, inferStageBlock)
 *  and the dashboard expect to find. */
export function restoreWriterLogs(stage: WriterStageResult): void {
  if (stage.kind !== "writer_done") return;
  const log = getTweetLog();
  log?.set(`${STEP.queryWriter}.queries`, stage.queries);
  log?.set(`${STEP.searchAnalyzer}.messages.1`, { content: stage.findings.slice(0, ANALYSIS_LOG_MAX_CHARS) });
  log?.set(`${STEP.noteWriter}.attempts.0.response`, { note_text: stage.noteText, sources: stage.sources });
}

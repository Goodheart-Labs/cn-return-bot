/**
 * Disk-backed writer-output cache for cheap-bot. Saves everything the two
 * gates (note-needed judge + source verifier) need, keyed by tweet id, so
 * hill-climbing iterations focused on FP reduction can replay just the judge
 * + verifier without re-running query writer, search, and the note writer.
 *
 * Gated by the CHEAP_BOT_WRITER_CACHE env var (path to a directory). Unset =
 * no caching (full pipeline, no read/write). On a populated cache, a run
 * starts "from the two judges".
 */
import * as fs from "fs";
import * as path from "path";
import type { PipelineOutcome } from "../../bots/types";

const CACHE_ENV = "CHEAP_BOT_WRITER_CACHE";

/** A search-result projection (title + snippet) kept for the verifier's
 *  fetch fallback. Shared between live search output and the cache. */
export type Snippet = { title: string; snippet: string };

/**
 * Result of stages 1-3. Either the pipeline terminated before the writer
 * produced a note (early_exit, replayable verbatim with no LLM calls), or the
 * writer produced a note and the gates still need to run (writer_done).
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

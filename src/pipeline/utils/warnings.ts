/**
 * Run-scoped warning collector.
 *
 * Non-fatal warnings (a media item that failed analysis, a fallback model being
 * used, etc.) can originate deep in the call stack — e.g. inside per-item media
 * analysis — far from the code that persists the pipeline run. Threading a
 * warnings array through every function in between is exactly the coupling we
 * avoid elsewhere, so warnings ride an AsyncLocalStorage sink, the same pattern
 * as tweetLog / costTracker.
 *
 * Any function under withWarnings() calls addWarning(); processTweet reads
 * getWarnings() at completion and writes them to pipeline_runs.warnings.
 * addWarning outside a scope (e.g. local one-off tools) is a safe no-op.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const warningStorage = new AsyncLocalStorage<string[]>();

/** Run `fn` with a fresh warning sink. getWarnings() returns whatever was
 *  collected within. */
export function withWarnings<T>(fn: () => T): T {
  return warningStorage.run([], fn);
}

/** Record a non-fatal warning for the current run (no-op outside a scope). */
export function addWarning(message: string): void {
  warningStorage.getStore()?.push(message);
}

/** All warnings collected so far in the current run ([] outside a scope). */
export function getWarnings(): string[] {
  return warningStorage.getStore() ?? [];
}

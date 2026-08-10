/**
 * Run-scoped warning collector.
 *
 * Warnings that are not fatal can come from deep in the call stack. Examples
 * are a media item that failed analysis, or a fallback model being used. The
 * code that raises them, such as per-item media analysis, sits far from the
 * code that persists the pipeline run. Threading a warnings array through every
 * function in between is exactly the coupling we avoid elsewhere. So warnings
 * ride an AsyncLocalStorage sink instead, the same pattern tweetLog and
 * costTracker use.
 *
 * Any function running under withWarnings() can call addWarning(). When
 * processTweet finishes it reads getWarnings() and writes the result to
 * pipeline_runs.warnings. Calling addWarning outside a scope is a safe no-op,
 * which is what local one-off tools do.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const warningStorage = new AsyncLocalStorage<string[]>();

/** Run `fn` with a fresh warning sink. getWarnings() returns whatever was
 *  collected within. */
export function withWarnings<T>(fn: () => T): T {
  return warningStorage.run([], fn);
}

/** Records a warning that is not fatal for the current run. Outside a scope
 *  this does nothing. */
export function addWarning(message: string): void {
  warningStorage.getStore()?.push(message);
}

/** Returns all warnings collected so far in the current run. Outside a scope it
 *  returns an empty array. */
export function getWarnings(): string[] {
  return warningStorage.getStore() ?? [];
}

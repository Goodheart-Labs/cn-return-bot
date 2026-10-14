/**
 * A person's request for a note on a post: who asked and what they wrote when
 * they asked. The X tag bot sets it when someone tags the bot under a post, so
 * the search and the writer read the request along with the post. Runs from the
 * feed have no request.
 *
 * This follows the same AsyncLocalStorage pattern as withMonitoringContext.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface NoteRequest {
  handle: string;
  text: string;
}

const storage = new AsyncLocalStorage<NoteRequest>();

export function withNoteRequest<T>(request: NoteRequest | undefined, fn: () => T): T {
  return request ? storage.run(request, fn) : fn();
}

export function getNoteRequest(): NoteRequest | undefined {
  return storage.getStore();
}

import { track } from "@cn/core/analytics";

/* Per-note views. notes_shown counts notes per page; these say which notes a
 * reader actually had on screen and which they opened:
 *  - note_seen: a note's marker or card stayed at least half on screen for
 *    SEEN_AFTER_MS. Once per note per page address.
 *  - note_opened: the reader opened the note's card. Every open counts.
 * Both are batched: one event row carries the ids of every note seen or opened
 * since the last send, at most IDS_PER_EVENT of them, because event props are
 * capped at 2 KB. A note's views are the rows whose props.note_ids holds its id. */

export type NoteSurface = "inline" | "youtube";

export const SEEN_AFTER_MS = 1000;
const FLUSH_MS = 5000;
const IDS_PER_EVENT = 30;

type NoteEvent = "note_seen" | "note_opened";

const queues: Record<NoteEvent, Map<NoteSurface, string[]>> = { note_seen: new Map(), note_opened: new Map() };
const seenOnPage = new Set<string>();
let seenOnPageUrl = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(event: NoteEvent, surface: NoteSurface, noteIds: string[]) {
  if (!noteIds.length) return;
  const queue = queues[event];
  queue.set(surface, [...(queue.get(surface) ?? []), ...noteIds]);
  flushTimer ??= setTimeout(flushNoteViews, FLUSH_MS);
}

export function flushNoteViews() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  for (const event of ["note_seen", "note_opened"] as const) {
    for (const [surface, ids] of queues[event]) {
      for (let i = 0; i < ids.length; i += IDS_PER_EVENT) track(event, { surface, note_ids: ids.slice(i, i + IDS_PER_EVENT) });
    }
    queues[event].clear();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNoteViews();
  });
}

/** Counts each note once per page address. YouTube and Substack move between
 *  pages without a reload, so the address, not the script's lifetime, is the page. */
export function noteSeen(surface: NoteSurface, noteIds: string[]) {
  const page = globalThis.location?.href ?? "";
  if (page !== seenOnPageUrl) {
    seenOnPageUrl = page;
    seenOnPage.clear();
  }
  const fresh = noteIds.filter((id) => !seenOnPage.has(id));
  fresh.forEach((id) => seenOnPage.add(id));
  enqueue("note_seen", surface, fresh);
}

export function noteOpened(surface: NoteSurface, noteIds: string[]) {
  enqueue("note_opened", surface, noteIds);
}

type Watched = { surface: NoteSurface; noteIds: string[]; timer: ReturnType<typeof setTimeout> | null };
const watched = new Map<Element, Watched>();
let observer: IntersectionObserver | null = null;

function onIntersect(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const w = watched.get(entry.target);
    if (!w) continue;
    if (entry.isIntersecting) {
      w.timer ??= setTimeout(() => {
        w.timer = null;
        noteSeen(w.surface, w.noteIds);
      }, SEEN_AFTER_MS);
    } else if (w.timer) {
      clearTimeout(w.timer);
      w.timer = null;
    }
  }
}

/** Watches a note's marker or card and records its notes as seen once it has
 *  been on screen for SEEN_AFTER_MS. Meant for a React ref callback: the
 *  returned cleanup runs on every re-render with an inline callback, so it only
 *  lets go of an element that has left the page, and a re-render does not
 *  restart the second. */
export function watchSeen(el: Element | null, surface: NoteSurface, noteIds: string[]): (() => void) | undefined {
  if (!el || typeof IntersectionObserver === "undefined") return;
  observer ??= new IntersectionObserver(onIntersect, { threshold: 0.5 });
  const existing = watched.get(el);
  if (existing) {
    existing.noteIds = noteIds;
  } else {
    watched.set(el, { surface, noteIds, timer: null });
    observer.observe(el);
  }
  return () => {
    queueMicrotask(() => {
      if (el.isConnected) return;
      const w = watched.get(el);
      if (w?.timer) clearTimeout(w.timer);
      watched.delete(el);
      observer?.unobserve(el);
    });
  };
}

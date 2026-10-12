import { fetchProgressClaimRows, fetchProgressItemRow, fetchRequestStatus, subscribeToItemProgress } from "@cn/core/requestStatus";
import {
  deriveRequestProgress,
  progressIsTerminal,
  type RequestProgress,
  type RequestStatusRow,
} from "@cn/core/requestProgress";

/* The watcher behind the progress card. Phase one exchanges the request's
 * token for its status until the intake has turned it into an item. Phase two
 * watches that item over one realtime channel, where every event is only a
 * poke: nothing renders from an event payload, because an item row can carry
 * 500 KB of body text and realtime truncates large records. Every poke turns
 * into one narrow refetch of the columns the card actually shows. */

/** How often phase one asks the database what became of the request. The
 *  intake normally answers within a couple of seconds. */
const STATUS_POLL_MS = 2_000;
/** When to stop asking. A request unanswered for this long means the intake is
 *  down, and the card says live progress is unavailable
 *  rather than spinning for ever. */
const STATUS_GIVE_UP_MS = 10 * 60 * 1000;
/** A burst of claim updates collapses into one refetch after this pause. */
const EVENT_DEBOUNCE_MS = 500;
/** Realtime has no replay after a reconnect, so a slow refetch runs on this
 *  interval regardless of events. */
const BACKSTOP_REFETCH_MS = 30_000;
/** How long the channel gets to reach SUBSCRIBED. A strict page content
 *  security policy can block a content script's websocket outright, and then
 *  polling is the only way to see progress. */
const SUBSCRIBE_TIMEOUT_MS = 10_000;
/** The poll that takes over when the channel never connects. */
const FALLBACK_POLL_MS = 5_000;

type StatusLookup = { kind: "row"; row: RequestStatusRow } | { kind: "no_row" } | { kind: "error" };

/** Exchanges the token for the request's status. A failure comes back as
 *  "error", and the caller simply asks again. */
async function lookUpRequest(token: string): Promise<StatusLookup> {
  try {
    const row = await fetchRequestStatus(token);
    return row ? { kind: "row", row } : { kind: "no_row" };
  } catch {
    return { kind: "error" };
  }
}

/** One reading of the request's current state, for callers that poll rather
 *  than watch. The popup lives for seconds and refreshes on an interval, so it
 *  uses this instead of a realtime channel. Also returns the item id once the
 *  lookup revealed it, so the caller can persist it and skip the lookup next
 *  time. */
export async function fetchProgressSnapshot(entry: {
  token: string;
  itemId?: string;
}): Promise<{ progress: RequestProgress; itemId: string | null }> {
  let itemId = entry.itemId ?? null;
  let request: RequestStatusRow | null = null;
  if (!itemId) {
    const lookup = await lookUpRequest(entry.token);
    // A transient lookup failure, or a request row the intake has not written
    // yet: the request stands, so the reader is simply waiting.
    if (lookup.kind === "error" || lookup.kind === "no_row") return { progress: { kind: "saved" }, itemId: null };
    request = lookup.row;
    itemId = lookup.row.item_id;
  }
  if (!itemId) return { progress: deriveRequestProgress(null, [], request), itemId: null };
  const [item, claims] = await Promise.all([fetchProgressItemRow(itemId), fetchProgressClaimRows(itemId)]);
  return { progress: deriveRequestProgress(item, claims, request), itemId };
}

export interface RequestWatch {
  stop(): void;
}

/** Watches one request until it reaches a terminal state and reports every
 *  state change through onProgress. Terminal states are delivered and then the
 *  watch tears itself down; the caller only has to call stop() when it goes
 *  away early, for example when the content script is invalidated. Stopping
 *  never cancels anything server-side. */
export function watchRequestProgress(params: {
  token: string;
  /** Skips the lookup phase when a stored entry already knows the item. */
  itemId?: string;
  onProgress: (progress: RequestProgress) => void;
  /** Called once when the lookup reveals the item, so the caller can persist
   *  it for the next visit. */
  onItemFound?: (itemId: string) => void;
}): RequestWatch {
  let stopped = false;
  let closeChannel: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let lastRequest: RequestStatusRow | null = null;

  const stop = () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    for (const interval of intervals) clearInterval(interval);
    timers.clear();
    intervals.clear();
    closeChannel?.();
    closeChannel = null;
  };

  const after = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const every = (ms: number, fn: () => void) => {
    const interval = setInterval(fn, ms);
    intervals.add(interval);
    return interval;
  };

  const emit = (progress: RequestProgress) => {
    if (stopped) return;
    params.onProgress(progress);
    if (progressIsTerminal(progress)) stop();
  };

  const watchItem = (itemId: string) => {
    const refetch = async () => {
      if (stopped) return;
      try {
        const [item, claims] = await Promise.all([fetchProgressItemRow(itemId), fetchProgressClaimRows(itemId)]);
        if (!stopped) emit(deriveRequestProgress(item, claims, lastRequest));
      } catch {
        // A failed refetch keeps the last state on screen. The backstop
        // interval, or the next event, tries again.
      }
    };

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const poke = () => {
      if (stopped) return;
      if (debounce) {
        clearTimeout(debounce);
        timers.delete(debounce);
      }
      debounce = after(EVENT_DEBOUNCE_MS, () => void refetch());
    };

    let connected = false;
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;
    closeChannel = subscribeToItemProgress(itemId, poke, () => {
      connected = true;
      if (fallbackPoll) {
        clearInterval(fallbackPoll);
        intervals.delete(fallbackPoll);
        fallbackPoll = null;
      }
    });
    after(SUBSCRIBE_TIMEOUT_MS, () => {
      if (!connected && !stopped) fallbackPoll = every(FALLBACK_POLL_MS, () => void refetch());
    });
    every(BACKSTOP_REFETCH_MS, () => void refetch());
    void refetch();
  };

  const startedAt = Date.now();
  const pollStatus = async () => {
    if (stopped) return;
    const lookup = await lookUpRequest(params.token);
    if (stopped) return;
    if (lookup.kind === "row") {
      lastRequest = lookup.row;
      if (lookup.row.item_id) {
        params.onItemFound?.(lookup.row.item_id);
        return watchItem(lookup.row.item_id);
      }
      emit(deriveRequestProgress(null, [], lookup.row));
      if (stopped) return;
    }
    if (Date.now() - startedAt > STATUS_GIVE_UP_MS) return emit({ kind: "unavailable" });
    after(STATUS_POLL_MS, () => void pollStatus());
  };

  // The card shows something the moment it mounts, before the first answer.
  emit({ kind: "saved" });
  if (params.itemId) watchItem(params.itemId);
  else void pollStatus();

  return { stop };
}

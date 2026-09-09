/**
 * The queue in front of a service. It limits how many calls are worked at once,
 * serves the most urgent first, and can hold slots back for reader work.
 *
 * The queue lives in memory rather than in a table. Restarting a service
 * therefore throws away calls that are waiting but not started, and the caller
 * retries them. That is the deliberate trade for having no queue tables, no
 * leases and no locking to get right.
 */

import { WORK_PRIORITY_ORDER, type HealthResponse, type WorkPriority } from "./contract";

interface WaitingCall {
  priority: WorkPriority;
  enqueuedAt: number;
  start: () => void;
}

interface InFlightCall {
  priority: WorkPriority;
  startedAt: number;
}

export interface WorkQueueOptions {
  /** How many calls the service works at once. */
  concurrency: number;
  /** How many of those slots may never be taken by anything other than reader
   *  work. It is what stops a reader waiting behind a long video: the video's
   *  claims fill the other slots and the reader's claims start immediately. */
  reservedForReader: number;
}

export class WorkQueue {
  private readonly waiting: WaitingCall[] = [];
  private readonly inFlight = new Set<InFlightCall>();

  constructor(private readonly options: WorkQueueOptions) {
    if (options.concurrency < 1) {
      throw new Error(`concurrency must be at least 1, got ${options.concurrency}`);
    }
    // Reserving every slot would mean nothing but reader work can ever start,
    // silently and forever. Failing here turns that misconfiguration into a
    // startup crash instead.
    if (options.reservedForReader < 0 || options.reservedForReader >= options.concurrency) {
      throw new Error(
        `reservedForReader must be between 0 and ${options.concurrency - 1}, got ${options.reservedForReader}`,
      );
    }
  }

  /** Waits for a free slot, then runs the task. The returned promise settles
   *  with whatever the task settles with. */
  run<T>(priority: WorkPriority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        priority,
        enqueuedAt: Date.now(),
        start: () => {
          const call: InFlightCall = { priority, startedAt: Date.now() };
          this.inFlight.add(call);
          task()
            .then(resolve, reject)
            .finally(() => {
              this.inFlight.delete(call);
              this.pump();
            });
        },
      });
      this.pump();
    });
  }

  health(service: HealthResponse["service"]): HealthResponse {
    return {
      service,
      inFlight: this.inFlight.size,
      waiting: this.waiting.length,
      oldestWaitSeconds: ageOfOldest(this.waiting.map((call) => call.enqueuedAt)),
      oldestInFlightSeconds: ageOfOldest([...this.inFlight].map((call) => call.startedAt)),
      concurrency: this.options.concurrency,
    };
  }

  /** Starts whatever can start right now. Called whenever a call arrives or a
   *  slot frees. The waiting list is short, so scanning it is cheap. */
  private pump(): void {
    for (;;) {
      const index = nextCallIndex(this.waiting, (priority) => this.canStart(priority));
      if (index === -1) return;
      const [call] = this.waiting.splice(index, 1);
      call!.start();
    }
  }

  private canStart(priority: WorkPriority): boolean {
    if (this.inFlight.size >= this.options.concurrency) return false;
    if (priority === "reader") return true;
    const besidesReader = [...this.inFlight].filter((call) => call.priority !== "reader").length;
    return besidesReader < this.options.concurrency - this.options.reservedForReader;
  }
}

function ageOfOldest(timestamps: number[]): number | null {
  if (timestamps.length === 0) return null;
  return Math.round((Date.now() - Math.min(...timestamps)) / 1000);
}

/** Picks the call that should run next out of those that may start at all: the
 *  most urgent one, and the longest waiting among equally urgent ones. Returns
 *  -1 when nothing may start. Exported so the ordering can be tested without a
 *  running service. */
export function nextCallIndex(
  calls: Array<{ priority: WorkPriority; enqueuedAt: number }>,
  canStart: (priority: WorkPriority) => boolean,
): number {
  let best = -1;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]!;
    if (!canStart(call.priority)) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const winner = calls[best]!;
    const moreUrgent = WORK_PRIORITY_ORDER[call.priority] > WORK_PRIORITY_ORDER[winner.priority];
    const equallyUrgentButOlder =
      WORK_PRIORITY_ORDER[call.priority] === WORK_PRIORITY_ORDER[winner.priority] &&
      call.enqueuedAt < winner.enqueuedAt;
    if (moreUrgent || equallyUrgentButOlder) best = i;
  }
  return best;
}

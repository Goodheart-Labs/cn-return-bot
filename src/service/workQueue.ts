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
  private inFlight = 0;
  private inFlightBesidesReader = 0;

  constructor(private readonly options: WorkQueueOptions) {}

  /** Waits for a free slot, then runs the task. The returned promise settles
   *  with whatever the task settles with. */
  run<T>(priority: WorkPriority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        priority,
        enqueuedAt: Date.now(),
        start: () => {
          this.inFlight++;
          if (priority !== "reader") this.inFlightBesidesReader++;
          task()
            .then(resolve, reject)
            .finally(() => {
              this.inFlight--;
              if (priority !== "reader") this.inFlightBesidesReader--;
              this.pump();
            });
        },
      });
      this.pump();
    });
  }

  health(service: HealthResponse["service"]): HealthResponse {
    const oldest = this.waiting.reduce<number | null>(
      (earliest, call) => (earliest === null || call.enqueuedAt < earliest ? call.enqueuedAt : earliest),
      null,
    );
    return {
      service,
      inFlight: this.inFlight,
      waiting: this.waiting.length,
      oldestWaitSeconds: oldest === null ? null : Math.round((Date.now() - oldest) / 1000),
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
    if (this.inFlight >= this.options.concurrency) return false;
    if (priority === "reader") return true;
    return this.inFlightBesidesReader < this.options.concurrency - this.options.reservedForReader;
  }
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

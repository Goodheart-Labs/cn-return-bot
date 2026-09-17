/**
 * The feed worker's loop, with everything it touches passed in, so that its
 * timing can be tested without a database, a queue or a clock to wait on.
 * main.ts supplies the real parts.
 *
 * One pass: write the heartbeat; if a slot is free and the pacing answer has
 * run out, ask again, which may start an item; then sleep until the answer
 * runs out, an item finishes, or the heartbeat is due, whichever comes first.
 */

export interface FeedLoopOptions {
  /** How many items are worked side by side. */
  maxItemsInFlight: number;
  /** The longest sleep, which is how often the heartbeat is written. */
  maxSleepMs: number;
  /** The longest the loop goes without asking the pacing rule again, however
   *  far away the rule said the next post is. The heartbeat wakes the loop far
   *  more often than this, and those wake-ups must not each cost a pacing
   *  query, which reads every recent post's cost rows. */
  maxPacingAnswerAgeMs: number;
  recordSeen: () => Promise<void>;
  /** Asks the pacing rule, and when a post is due takes the next item and
   *  hands its work to `start`. Returns how long the answer holds, in
   *  milliseconds: zero after a start, because the start moved the pacing
   *  marker and the rule has to be asked afresh. */
  startItemIfDue: (start: (work: () => Promise<void>) => void) => Promise<number>;
}

export interface FeedLoop {
  /** Resolves once the loop was asked to drain and nothing is in flight.
   *  Rejects when an item's work throws, which means the item's outcome could
   *  not be recorded, and a worker that cannot record must stop loudly. */
  run(): Promise<void>;
  /** Start nothing new, finish what is in flight, then let `run` resolve. */
  drain(): void;
}

export function createFeedLoop(options: FeedLoopOptions): FeedLoop {
  let draining = false;
  let itemsInFlight = 0;
  let fatalError: unknown = null;

  // A wake-up that arrives while the loop is busy rather than asleep is
  // remembered, so the next sleep returns at once instead of losing it.
  let wokenWhileBusy = false;
  let endSleep: (() => void) | null = null;

  const wakeLoop = (): void => {
    if (endSleep) endSleep();
    else wokenWhileBusy = true;
  };

  const sleepUntilWoken = (ms: number): Promise<void> => {
    if (wokenWhileBusy) {
      wokenWhileBusy = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      endSleep = () => {
        clearTimeout(timer);
        endSleep = null;
        resolve();
      };
      const timer = setTimeout(endSleep, Math.min(Math.max(ms, 0), options.maxSleepMs));
    });
  };

  const start = (work: () => Promise<void>): void => {
    itemsInFlight++;
    work()
      .catch((err) => {
        fatalError = err;
      })
      .finally(() => {
        itemsInFlight--;
        wakeLoop();
      });
  };

  return {
    drain() {
      draining = true;
      wakeLoop();
    },
    async run() {
      let askPacingAgainAt = 0;
      while (!(draining && itemsInFlight === 0)) {
        if (fatalError) throw fatalError;
        await options.recordSeen();
        const hasFreeSlot = !draining && itemsInFlight < options.maxItemsInFlight;
        if (hasFreeSlot && Date.now() >= askPacingAgainAt) {
          askPacingAgainAt = Date.now() + Math.min(await options.startItemIfDue(start), options.maxPacingAnswerAgeMs);
        }
        // With every slot taken there is nothing to wait for but a finished
        // item, which wakes the loop by itself.
        await sleepUntilWoken(hasFreeSlot ? askPacingAgainAt - Date.now() : options.maxSleepMs);
      }
      if (fatalError) throw fatalError;
    },
  };
}

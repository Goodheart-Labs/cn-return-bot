import type { SubmissionCapacity } from "../pipeline/capacity/submissionReserve";
import type { SignalStore } from "./store";

export interface PipelineRunRow {
  tweet_id: string;
  created_at: string;
  outcome: string;
  outcome_reason?: string | null;
  final_stage?: string | null;
}

interface RunSummaryDependencies {
  listRunsSince: (since: string, limit: number) => Promise<PipelineRunRow[]>;
  capacity: () => Promise<SubmissionCapacity>;
  send: (text: string) => Promise<unknown>;
  store: SignalStore;
  now?: () => Date;
  onError?: (error: unknown) => void;
  /** How far back the first poll looks, so a fresh worker can show recent runs. */
  lookbackMs?: number;
}

const CURSOR_KEY = "run_summary_cursor";
/** Rows of one scheduled run land within minutes; runs are half an hour apart. */
const CYCLE_GAP_MS = 10 * 60_000;
/** A run is reported once its newest row is this old and nothing is still in progress. */
const SETTLE_MS = 6 * 60_000;
/** An in-progress row older than this is reported as stuck rather than waited for. */
const STUCK_MS = 25 * 60_000;

function pacific(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function groupCycles(rows: PipelineRunRow[]): PipelineRunRow[][] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const cycles: PipelineRunRow[][] = [];
  for (const row of sorted) {
    const current = cycles.at(-1);
    if (current && Date.parse(row.created_at) - Date.parse(current.at(-1)!.created_at) <= CYCLE_GAP_MS) current.push(row);
    else cycles.push([row]);
  }
  return cycles;
}

export function formatRunSummary(cycle: PipelineRunRow[], capacity: SubmissionCapacity | undefined, now: number): string {
  const started = cycle[0]!.created_at;
  const submitted = cycle.filter((row) => row.outcome === "submitted").length;
  const stuck = cycle.filter((row) => row.outcome === "in_progress" && now - Date.parse(row.created_at) > STUCK_MS).length;
  const lines = [`Run ${started.slice(11, 16)} UTC (${pacific(started)} PT) · ${cycle.length} tweet${cycle.length === 1 ? "" : "s"} processed · ${submitted} note${submitted === 1 ? "" : "s"} posted`];
  const buckets = new Map<string, number>();
  for (const row of cycle) {
    if (row.outcome === "in_progress") continue;
    const stage = row.final_stage ? ` at ${row.final_stage}` : "";
    const reason = row.outcome_reason ? ` (${row.outcome_reason})` : "";
    const key = `${row.outcome}${stage}${reason}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- ${count} ${key}`);
  if (stuck) lines.push(`- ${stuck} still marked in progress after ${Math.round(STUCK_MS / 60_000)} min (probably a crashed run)`);
  if (capacity) {
    lines.push(`Writing limit: ${capacity.used24h}/${capacity.cap} used in 24h · ${capacity.remaining} remaining` +
      `${capacity.probe ? " · probe mode (one attempt allowed to test the limit)" : ""}${capacity.signalQueued ? ` · ${capacity.signalQueued} Signal note${capacity.signalQueued === 1 ? "" : "s"} queued` : ""}`);
  }
  return lines.join("\n");
}

/** Posts one summary per scheduled pipeline run: what it processed, where each
 * tweet stopped, how many notes went out, and the writing-limit state. */
export class RunSummaries {
  private polling = false;

  constructor(private readonly deps: RunSummaryDependencies) {}

  cursor(): string {
    const stored = this.deps.store.getMetadata(CURSOR_KEY);
    if (stored) return stored;
    const start = new Date((this.deps.now ?? (() => new Date()))().getTime() - (this.deps.lookbackMs ?? 0)).toISOString();
    this.deps.store.setMetadata(CURSOR_KEY, start);
    return start;
  }

  /** Returns how many run summaries were posted. */
  async poll(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    let posted = 0;
    try {
      const now = (this.deps.now ?? (() => new Date()))().getTime();
      const rows = (await this.deps.listRunsSince(this.cursor(), 500)).filter((row) => row.created_at > this.cursor());
      let capacity: SubmissionCapacity | undefined;
      for (const cycle of groupCycles(rows)) {
        const newest = Date.parse(cycle.at(-1)!.created_at);
        const waiting = cycle.some((row) => row.outcome === "in_progress" && now - Date.parse(row.created_at) <= STUCK_MS);
        if (now - newest < SETTLE_MS || waiting) break;
        if (!capacity) {
          try { capacity = await this.deps.capacity(); }
          catch (error) { this.deps.onError?.(error); }
        }
        await this.deps.send(formatRunSummary(cycle, capacity, now));
        this.deps.store.setMetadata(CURSOR_KEY, cycle.at(-1)!.created_at);
        posted++;
      }
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.polling = false;
    }
    return posted;
  }
}

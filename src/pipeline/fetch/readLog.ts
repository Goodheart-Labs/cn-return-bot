/**
 * The read log: a record of every read the page reader does, so we can look
 * later at which step served which site, how long each took and what came
 * back (GOO-766).
 *
 * Only the services keep it, because their unit files set PAGE_READ_LOG_DIR.
 * A read anywhere else, such as a script on the devbox, records nothing.
 *
 * Each read becomes one row in the table page_reads: the service that read,
 * the address, every step it tried with its result, and the outcome. The same
 * record plus the text that came back goes as one line into a file per day in
 * PAGE_READ_LOG_DIR. The text stays out of the database, because all reads
 * together come to tens of megabytes a day. The files are kept 30 days.
 *
 * The steps are collected without passing anything along: a read runs inside
 * an AsyncLocalStorage, a Node feature that keeps a value for everything one
 * call starts, and each step adds itself to the list it finds there.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { getSupabaseClient } from "../../api/supabaseClient";

/** One step of a read, such as one request of the fetch ladder or the forum's
 *  GraphQL API. `startMs` counts from the start of the read, so steps that
 *  contain other steps, such as an API that went through a browser, still
 *  show in the order they ran. */
export interface ReadStep {
  step: string;
  /** The address the step asked, when it is not the read's own, such as the
   *  GraphQL query behind a forum post. */
  address?: string;
  result: string;
  status?: number;
  chars?: number;
  startMs: number;
  ms: number;
}

/** What a finished read gave. `text` goes only into the day's file. */
export interface ReadOutcome {
  outcome: string;
  via: string | null;
  chars: number | null;
  reason: string | null;
  text: string | null;
}

interface ReadTrail {
  startedAt: number;
  steps: ReadStep[];
}

const DAYS_KEPT = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

const trails = new AsyncLocalStorage<ReadTrail>();
let lastPrunedDay: string | null = null;

/** Runs a step of the read and adds it to the read's record. `describe` turns
 *  the step's answer into its result and size. A step that throws is recorded
 *  as an error and throws on. */
export async function readStep<T>(
  step: string,
  run: () => Promise<T>,
  describe: (answer: T) => Pick<ReadStep, "address" | "result" | "status" | "chars">,
): Promise<T> {
  const trail = trails.getStore();
  if (!trail) return run();
  const started = Date.now();
  const timing = () => ({ startMs: started - trail.startedAt, ms: Date.now() - started });
  try {
    const answer = await run();
    trail.steps.push({ step, ...describe(answer), ...timing() });
    return answer;
  } catch (err) {
    trail.steps.push({ step, result: `error: ${(err as Error).message}`, ...timing() });
    throw err;
  }
}

/** Adds steps that ran elsewhere, such as the fetcher's ladder, which reports
 *  each of its attempts with its timing. */
export function addSteps(steps: Array<Omit<ReadStep, "startMs">>, startedAt: number): void {
  const trail = trails.getStore();
  if (!trail) return;
  let offset = startedAt - trail.startedAt;
  for (const step of steps) {
    trail.steps.push({ ...step, startMs: offset });
    offset += step.ms;
  }
}

/** Runs one read and records it. A read that throws is recorded as an error
 *  and throws on. Writing the record happens after the answer is back and never
 *  fails the read: a lost record only costs the record, while a failed read
 *  would cost the claim check or the post that needed it. A write that fails
 *  is reported in the service's log. */
export async function logRead<T>(kind: "page" | "listing", input: string, read: () => Promise<T>, summarize: (answer: T) => ReadOutcome): Promise<T> {
  const dir = process.env.PAGE_READ_LOG_DIR;
  if (!dir) return read();
  const trail: ReadTrail = { startedAt: Date.now(), steps: [] };
  const finish = (outcome: ReadOutcome) =>
    void writeRecord(dir, kind, input, trail, outcome).catch((err) => console.error(`[read-log] could not record the read of ${input}:`, err));
  try {
    const answer = await trails.run(trail, read);
    finish(summarize(answer));
    return answer;
  } catch (err) {
    finish({ outcome: "error", via: null, chars: null, reason: (err as Error).message, text: null });
    throw err;
  }
}

async function writeRecord(dir: string, kind: "page" | "listing", input: string, trail: ReadTrail, { text, ...outcome }: ReadOutcome): Promise<void> {
  const readAt = new Date(trail.startedAt).toISOString();
  const record = {
    id: randomUUID(),
    read_at: readAt,
    service: process.env.CN_SERVICE ?? "unknown",
    kind,
    input,
    ...outcome,
    duration_ms: Date.now() - trail.startedAt,
    steps: trail.steps,
  };
  const day = readAt.slice(0, 10);
  await appendFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify({ ...record, text })}\n`);
  if (lastPrunedDay !== day) await pruneOldFiles(dir, day);
  const { error } = await getSupabaseClient().from("page_reads").insert(record);
  if (error) throw new Error(error.message);
}

/** Deletes the day files older than DAYS_KEPT, once a day per process. */
async function pruneOldFiles(dir: string, today: string): Promise<void> {
  lastPrunedDay = today;
  const oldest = new Date(Date.parse(today) - DAYS_KEPT * MS_PER_DAY).toISOString().slice(0, 10);
  for (const file of await readdir(dir)) {
    const day = LOG_FILE.exec(file)?.[1];
    if (day && day < oldest) await unlink(path.join(dir, file));
  }
}

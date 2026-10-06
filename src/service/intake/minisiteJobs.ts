/* Work the website hands to the intake service for minisites, as rows in
 * everything_minisite_jobs (migration 117).
 *
 * A read_page job reads the page at its address and writes the title,
 * description, byline, date, picture and text into the row's result. The admin
 * watches the row and sees the result the moment it lands. A fact_check job is
 * written when an admin starts a minisite's fact-check. The database function
 * that writes it has already queued the article at the reader-request tier, so
 * the job only has to wake the loop that works that tier. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../api/supabaseClient";
import { PageReadError, readPageForMinisite, type MinisitePage } from "../../everything/minisites/readPage";
import { checked } from "./supabaseResult";

const JOBS_TABLE = "everything_minisite_jobs";

/** Reading a page takes about two minutes at worst, when the fetch ladder falls
 *  all the way through to the headless browser. A job still running long after
 *  that was cut off by a crash or a restart. */
const STALE_RUNNING_JOB_MS = 15 * 60_000;

// The admin sees these sentences on the website.
const INTERRUPTED_JOB = "Reading the page was interrupted. Please try again.";
const UNREADABLE_PAGE = "We could not read this page. Please try again.";

type MinisiteJob =
  | { id: string; kind: "read_page"; url: string }
  | { id: string; kind: "fact_check"; minisiteId: string };

type JobOutcome =
  | { status: "done"; result: MinisitePage | null }
  | { status: "error"; error: string };

interface JobRow {
  id: string;
  kind: string;
  url: string | null;
  minisite_id: string | null;
}

interface MinisiteJobDeps {
  db: SupabaseClient;
  readPage: (url: string) => Promise<MinisitePage>;
}

/** Works every pending job, oldest first, until none is left. Jobs that arrive
 *  meanwhile are picked up in the same call. */
export async function consumeMinisiteJobs(
  wakeRequestedQueue: () => void,
  deps: MinisiteJobDeps = { db: getSupabaseClient(), readPage: readPageForMinisite },
): Promise<void> {
  await failInterruptedJobs(deps.db);
  for (;;) {
    const job = await claimNextJob(deps.db);
    if (!job) return;
    await finishJob(deps.db, job.id, await jobOutcome(job, deps.readPage));
    if (job.kind === "fact_check") wakeRequestedQueue();
  }
}

/** A job a crashed service left running is marked as an error, not run
 *  again, the same way interrupted passage questions are. The admin presses
 *  the button again. */
async function failInterruptedJobs(db: SupabaseClient): Promise<void> {
  checked(await db.from(JOBS_TABLE).update({ status: "error", error: INTERRUPTED_JOB, finished_at: new Date().toISOString() })
    .eq("status", "running").lt("started_at", new Date(Date.now() - STALE_RUNNING_JOB_MS).toISOString()));
}

/** Moves the oldest pending job to running. The update only matches while the
 *  row is still pending, so a job is never claimed twice. */
async function claimNextJob(db: SupabaseClient): Promise<MinisiteJob | null> {
  for (;;) {
    const [next] = checked(await db.from(JOBS_TABLE).select("id").eq("status", "pending").order("created_at").limit(1)) as { id: string }[];
    if (!next) return null;
    const claimed = checked(await db.from(JOBS_TABLE).update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", next.id).eq("status", "pending").select("id, kind, url, minisite_id").maybeSingle()) as JobRow | null;
    if (claimed) return toJob(claimed);
  }
}

/** The table's check constraints guarantee the fields each kind needs. */
function toJob(row: JobRow): MinisiteJob {
  if (row.kind === "read_page" && row.url) return { id: row.id, kind: "read_page", url: row.url };
  if (row.kind === "fact_check" && row.minisite_id) return { id: row.id, kind: "fact_check", minisiteId: row.minisite_id };
  throw new Error(`Minisite job ${row.id} has an unknown kind or misses its fields: ${row.kind}`);
}

async function jobOutcome(job: MinisiteJob, readPage: MinisiteJobDeps["readPage"]): Promise<JobOutcome> {
  switch (job.kind) {
    case "read_page":
      return readPageOutcome(job.url, readPage);
    case "fact_check":
      return { status: "done", result: null };
  }
}

/** The failure is recorded on the job, because the admin waiting for it has
 *  no other way to learn about it. */
async function readPageOutcome(url: string, readPage: MinisiteJobDeps["readPage"]): Promise<JobOutcome> {
  try {
    return { status: "done", result: await readPage(url) };
  } catch (err) {
    console.error(`[intake] minisite page ${url}:`, err);
    return { status: "error", error: err instanceof PageReadError ? err.message : UNREADABLE_PAGE };
  }
}

async function finishJob(db: SupabaseClient, id: string, outcome: JobOutcome): Promise<void> {
  checked(await db.from(JOBS_TABLE).update({ ...outcome, finished_at: new Date().toISOString() }).eq("id", id));
}

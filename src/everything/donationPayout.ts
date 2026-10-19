/**
 * Works out how much the team owes in vote donations at a given moment, and
 * afterwards marks exactly those donations as paid (GOO-216).
 *
 * Every vote mints a donation with two frozen amounts: one paid if the note
 * ends up rated helpful, one if it ends up rated not helpful. A donation is
 * owed once its note is rated, which `noteStatus` decides. A note that still
 * needs ratings owes nothing yet, and a later payout picks it up.
 *
 * The check is pinned to a time, the `--at` argument. Votes keep arriving
 * between the check and the moment Nathan pays, so the script rebuilds every
 * note's tally as it stood at that time. It starts from today's counts and
 * undoes every vote event logged after the check time in
 * `everything_vote_history`. That log only began on 2026-10-06, so the check
 * time must come after its first row.
 *
 * A paid donation is marked by writing the amount paid into
 * `everything_donations.amount_usd`, the column migration 061 set aside for
 * the settled amount. Rows that already have an amount are never touched, so
 * running the script again only ever adds rows that became owed since.
 *
 * Usage:
 *   bun run donation-payout                            # report what is owed right now
 *   bun run donation-payout --at <ISO time>            # report what was owed at that time
 *   bun run donation-payout --at <ISO time> --write    # mark those rows as paid
 *   bun run donation-payout --at <ISO time> --write --exclude-team
 *
 * With `--exclude-team`, donations from admin accounts (`everything_admins`)
 * are settled at $0 instead of their amount. The team paid nothing for them,
 * and the $0 keeps them out of every later payout.
 */

import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { noteStatus } from "../everything-core/noteScore";
import { fetchAllRows, fetchInBatches } from "../everything-core/paging";
import type { NoteRow } from "../everything-core/types";
import { teamVoterIds } from "./teamAccounts";

interface Donation {
  id: string;
  vote_id: string;
  charity: string;
  amount_if_helpful: number;
  amount_if_not_helpful: number;
  created_at: string;
}

interface VoteRow {
  id: string;
  note_id: string;
  voter_id: string;
}

type NoteCounts = Pick<NoteRow, "id" | "author_id" | "helpful_count" | "somewhat_helpful_count" | "not_helpful_count">;

interface VoteEvent {
  id: number;
  target_id: string;
  voter_id: string;
  action: "cast" | "changed" | "retracted" | "cascaded";
  old_vote: number | null;
  new_vote: number | null;
}

/** One donation the check found owed, with the amount to pay. */
interface Payable {
  donation: Donation;
  amount: number;
  isTeam: boolean;
}

/** Why an unpaid donation that existed at the check time is not paid now. */
interface SkipCounts {
  noteNotRated: number;
  voteChangedSinceCheck: number;
}

const db = getSupabaseClient();

function parseArgs(argv: string[]) {
  const atIndex = argv.indexOf("--at");
  const checkTime = atIndex === -1 ? new Date() : new Date(argv[atIndex + 1] ?? NaN);
  if (Number.isNaN(checkTime.getTime())) throw new Error(`--at needs an ISO time, got "${argv[atIndex + 1]}"`);
  if (checkTime.getTime() > Date.now()) throw new Error("--at lies in the future");
  return { checkTime, write: argv.includes("--write"), excludeTeam: argv.includes("--exclude-team") };
}

async function unpaidDonations(): Promise<Donation[]> {
  return fetchAllRows<Donation>(
    () =>
      db
        .from("everything_donations")
        .select("id, vote_id, charity, amount_if_helpful, amount_if_not_helpful, created_at")
        .is("amount_usd", null),
    "id",
    { label: "unpaid donations" },
  );
}

/** Every vote event on a note after the check time, oldest first. It throws if
 *  the log does not reach back to the check time, because the tallies could
 *  not be rebuilt then. */
async function voteEventsSince(checkTime: Date): Promise<VoteEvent[]> {
  const { data: first, error } = await db
    .from("everything_vote_history")
    .select("at")
    .order("at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!first || new Date(first.at) > checkTime) {
    throw new Error(`The vote history starts at ${first?.at ?? "nothing"}, after the check time, so tallies at the check time cannot be rebuilt`);
  }
  return fetchAllRows<VoteEvent>(
    () =>
      db
        .from("everything_vote_history")
        .select("id, target_id, voter_id, action, old_vote, new_vote")
        .eq("vote_table", "everything_votes")
        .gt("at", checkTime.toISOString()),
    "id",
    { label: "vote history" },
  );
}

const COUNT_COLUMN = { 1: "helpful_count", 0: "somewhat_helpful_count", [-1]: "not_helpful_count" } as const;

function shiftCount(note: NoteCounts, vote: number | null, delta: number) {
  if (vote === null) return;
  const column = COUNT_COLUMN[vote as keyof typeof COUNT_COLUMN];
  note[column] += delta;
}

/** Turns today's counts back into the counts at the check time, by undoing
 *  every later event from the newest to the oldest. It changes `notes` in
 *  place. */
function rewindCounts(notes: Map<string, NoteCounts>, eventsSinceCheck: VoteEvent[]) {
  for (let i = eventsSinceCheck.length - 1; i >= 0; i--) {
    const event = eventsSinceCheck[i]!;
    const note = notes.get(event.target_id);
    if (!note) continue;
    shiftCount(note, event.new_vote, -1);
    shiftCount(note, event.old_vote, +1);
  }
}

/** Splits the donations that existed at the check time into those owed then
 *  and those skipped. A vote changed after the check had its donation re-priced
 *  by the client, so the stored pair is no longer the one from the check time.
 *  Such a donation waits for the next payout. */
function settle(params: {
  donations: Donation[];
  votes: Map<string, VoteRow>;
  notesAtCheck: Map<string, NoteCounts>;
  changedVoteKeys: Set<string>;
  teamIds: Set<string>;
}): { payable: Payable[]; skipped: SkipCounts } {
  const payable: Payable[] = [];
  const skipped: SkipCounts = { noteNotRated: 0, voteChangedSinceCheck: 0 };
  for (const donation of params.donations) {
    const vote = params.votes.get(donation.vote_id)!;
    if (params.changedVoteKeys.has(`${vote.note_id}:${vote.voter_id}`)) {
      skipped.voteChangedSinceCheck++;
      continue;
    }
    const status = noteStatus(params.notesAtCheck.get(vote.note_id)!);
    if (status === "needs_ratings") {
      skipped.noteNotRated++;
      continue;
    }
    const amount = status === "helpful" ? donation.amount_if_helpful : donation.amount_if_not_helpful;
    payable.push({ donation, amount, isTeam: params.teamIds.has(vote.voter_id) });
  }
  return { payable, skipped };
}

const dollars = (amount: number) => `$${amount.toFixed(2)}`;

function totalsByCharity(payable: Payable[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of payable) totals.set(p.donation.charity, (totals.get(p.donation.charity) ?? 0) + p.amount);
  return totals;
}

function printTotals(heading: string, payable: Payable[]) {
  const total = payable.reduce((sum, p) => sum + p.amount, 0);
  console.log(`\n${heading}: ${dollars(total)} over ${payable.length} donations`);
  for (const [charity, amount] of [...totalsByCharity(payable)].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${charity.padEnd(14)} ${dollars(amount)}`);
  }
}

function printReport(checkTime: Date, payable: Payable[], skipped: SkipCounts, createdAfterCheck: number) {
  console.log(`Donations owed at ${checkTime.toISOString()} that are not marked paid yet`);
  printTotals("Including team votes", payable);
  printTotals("Excluding team votes", payable.filter((p) => !p.isTeam));
  console.log(
    `\nNot owed yet: ${skipped.noteNotRated} on notes that still need ratings, ` +
      `${skipped.voteChangedSinceCheck} whose vote changed after the check, ` +
      `${createdAfterCheck} made after the check.`,
  );
}

/** Writes the amount paid into each row. The `amount_usd is null` filter means a
 *  row someone already marked is never overwritten. */
async function markPaid(payable: Payable[], excludeTeam: boolean) {
  for (const p of payable) {
    const amountPaid = excludeTeam && p.isTeam ? 0 : p.amount;
    const { data, error } = await db
      .from("everything_donations")
      .update({ amount_usd: amountPaid })
      .eq("id", p.donation.id)
      .is("amount_usd", null)
      .select("id");
    if (error) throw error;
    if (data.length !== 1) throw new Error(`donation ${p.donation.id} was not updated; was it marked paid meanwhile?`);
  }
  console.log(`\nMarked ${payable.length} donations as paid${excludeTeam ? ", team donations at $0" : ""}.`);
}

async function main() {
  const { checkTime, write, excludeTeam } = parseArgs(process.argv.slice(2));
  const unpaid = await unpaidDonations();
  const existedAtCheck = unpaid.filter((d) => new Date(d.created_at) <= checkTime);

  const votes = await fetchInBatches<VoteRow>(
    (ids) => db.from("everything_votes").select("id, note_id, voter_id").in("id", ids),
    existedAtCheck.map((d) => d.vote_id),
    "id",
    { label: "votes" },
  );
  const noteIds = [...new Set(votes.map((v) => v.note_id))];
  const notes = await fetchInBatches<NoteCounts>(
    (ids) => db.from("everything_notes").select("id, author_id, helpful_count, somewhat_helpful_count, not_helpful_count").in("id", ids),
    noteIds,
    "id",
    { label: "notes" },
  );

  const events = await voteEventsSince(checkTime);
  const notesAtCheck = new Map(notes.map((n) => [n.id, n]));
  rewindCounts(notesAtCheck, events);
  const changedVoteKeys = new Set(events.filter((e) => e.action === "changed").map((e) => `${e.target_id}:${e.voter_id}`));

  const { payable, skipped } = settle({
    donations: existedAtCheck,
    votes: new Map(votes.map((v) => [v.id, v])),
    notesAtCheck,
    changedVoteKeys,
    teamIds: await teamVoterIds(),
  });
  printReport(checkTime, payable, skipped, unpaid.length - existedAtCheck.length);

  if (write) await markPaid(payable, excludeTeam);
  else console.log("\nReport only. Add --write to mark these donations as paid.");
}

await main();

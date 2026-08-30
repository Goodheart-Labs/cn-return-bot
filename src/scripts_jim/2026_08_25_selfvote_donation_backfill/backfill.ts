/**
 * One-off backfill for GOO-39: mint the missing donations for authors'
 * automatic self-votes on notes written before betting on your own note
 * shipped. Idempotent, because the ledger is keyed unique on the vote id and
 * an existing row is left alone.
 *
 * An author's self-vote is always the note's first vote, so its donation is
 * the first-vote pair from an empty tally, computed by the same formula every
 * live vote uses. The charity defaults to the ledger's default; the author can
 * redirect it from the site as usual.
 *
 * Run with the service key in the environment (the same .env the pipeline
 * uses):
 *   bun run src/scripts_jim/2026_08_25_selfvote_donation_backfill/backfill.ts            # dry run
 *   bun run src/scripts_jim/2026_08_25_selfvote_donation_backfill/backfill.ts --write    # write rows
 */
import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { donationPair } from "../../everything-web/src/lib/donationScoring";
import { CHARITIES } from "../../everything-web/src/lib/donations";

const write = process.argv.includes("--write");
const db = getSupabaseClient();

// Every self-vote: the note's author voting on their own note. The pages are
// small (a few hundred notes exist), so one fetch per table is fine.
const { data: notes, error: notesError } = await db
  .from("everything_notes")
  .select("id, author_id")
  .not("author_id", "is", null);
if (notesError) throw notesError;

const { data: votes, error: votesError } = await db.from("everything_votes").select("id, note_id, voter_id, vote");
if (votesError) throw votesError;

const { data: donations, error: donationsError } = await db.from("everything_donations").select("vote_id");
if (donationsError) throw donationsError;
const donated = new Set((donations ?? []).map((d) => d.vote_id));

const authorByNote = new Map((notes ?? []).map((n) => [n.id, n.author_id as string]));
const selfVotes = (votes ?? []).filter((v) => authorByNote.get(v.note_id) === v.voter_id && !donated.has(v.id));

// The trigger casts Helpful, but an author can have changed their vote since.
// The pair follows the vote as it stands, from the empty tally the self-vote
// walked into.
const emptyTally = { helpful: 0, somewhatHelpful: 0, notHelpful: 0 };
const rows = selfVotes.map((vote) => {
  const pair = donationPair(emptyTally, vote.vote as 1 | 0 | -1);
  return {
    vote_id: vote.id,
    charity: CHARITIES[0].id,
    amount_if_helpful: pair.ifHelpful,
    amount_if_not_helpful: pair.ifNotHelpful,
  };
});
const ceiling = rows.reduce((sum, r) => sum + Math.max(r.amount_if_helpful, r.amount_if_not_helpful), 0);
console.log(`${(votes ?? []).length} votes, ${selfVotes.length} self-votes without a donation`);
console.log(`ceiling across all outcomes: $${ceiling.toFixed(2)}`);

if (!write) {
  console.log("Dry run. Re-run with --write to insert the ledger rows.");
  process.exit(0);
}

for (const row of rows) {
  const { error } = await db.from("everything_donations").insert(row);
  if (error) throw new Error(`vote ${row.vote_id}: ${error.message}`);
}
console.log(`Inserted ${rows.length} donation rows.`);

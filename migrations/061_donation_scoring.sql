-- Common Notes: outcome-contingent donations (log market scoring rule).
--
-- Every note vote (except votes on your own note) now mints a donation whose
-- final amount depends on how the note settles. At vote time the client
-- computes a frozen pair from the note's running vote tally:
--   amount_if_helpful     — donated if the note settles rated helpful
--   amount_if_not_helpful — donated if it settles rated not helpful
-- The pair is the log-market-scoring-rule payment for the information the
-- vote added (early consensus-shifting votes earn more than late pile-ons),
-- plus a flat base. Parameters and derivation:
-- src/scripts_jim/2026_07_17_donation_scoring/RESULTS.md (preset S2).
--
-- Reasoning is no longer required — the donation rewards the vote itself.
-- amount_usd becomes the SETTLED amount: null until the note's outcome locks
-- in, then set (manually, at fulfilment) to one side of the pair. Rows from
-- the old flat-$2 scheme keep amount_usd = 2 and a null pair. A voter whose
-- settled total would be negative simply donates $0 (floor at fulfilment).
--
-- Run as postgres (SQL editor / psql), on local and prod.

alter table everything_donations
  add column amount_if_helpful numeric,
  add column amount_if_not_helpful numeric;

alter table everything_donations
  alter column amount_usd drop not null,
  alter column amount_usd drop default;

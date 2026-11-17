-- The page reader's log (GOO-766). One row per read of an outside page or a
-- creator's listing, written by the services after each read
-- (src/pipeline/fetch/readLog.ts). It holds the input, every step the read
-- tried and the outcome, so we can see later which step serves which site and
-- what fails. The text that came back is not here: it goes, with the same
-- record, into a file per day on the services box, kept 30 days, because all
-- reads together come to tens of megabytes a day.
--
-- Only the service role writes and reads it, so the anon and authenticated
-- roles get nothing.
create table page_reads (
  id uuid primary key,
  read_at timestamptz not null,
  service text not null,
  kind text not null check (kind in ('page', 'listing')),
  input text not null,
  outcome text not null,
  via text,
  chars integer,
  reason text,
  duration_ms integer not null,
  steps jsonb not null
);

create index page_reads_read_at on page_reads (read_at desc);

alter table page_reads enable row level security;
revoke all on page_reads from anon, authenticated;

notify pgrst, 'reload schema';

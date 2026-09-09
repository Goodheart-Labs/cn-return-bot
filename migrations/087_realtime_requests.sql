-- Real time note requests (GOO-88): what the extension needs to show a reader
-- live progress on a request, and what the intake service needs to hear about
-- new requests instantly.
--
-- The extension watches the item behind its request over Supabase Realtime.
-- everything_items, everything_claims and everything_notes are already in the
-- publication with anon select policies (migration 050), so most of the
-- progress feed exists. Two things are missing. During claim extraction the
-- pipeline writes nothing, so the reader would stare at a silent gap; the
-- progress column fills it. And the reader's browser has no way to find the
-- item its own request became, because the requests table is insert-only for
-- clients; the token and its lookup function provide exactly that and nothing
-- more.

-- 1. Live stage of an item being worked. Written by whoever processes the
--    item, at stage boundaries only; null when the item is idle or finished.
alter table everything_items add column progress jsonb;

comment on column everything_items.progress is
  'Live pipeline stage for the extension progress card. {"stage":"extracting"} while claims are being found. {"stage":"checking","total":n} while n claims are being checked; the reader''s browser counts finished claims itself from the claim rows. {"stage":"budget_exhausted"} on a queued requested item that cannot run because even the reserved request budget is spent for the day. Null when idle or finished.';

-- 2. The requesting device's handle on its own request. The device generates a
--    random token and stores it with the insert. The token is unguessable, so
--    knowing it proves the row is yours. There is still no select policy on
--    the table: a request row holds the page a reader was on and up to 500 KB
--    of captured page text, and most requests are anonymous, so no ownership
--    rule could separate your rows from everyone else's.
alter table everything_note_requests add column client_token uuid;

create index everything_note_requests_client_token_idx
  on everything_note_requests (client_token)
  where client_token is not null;

comment on column everything_note_requests.client_token is
  'Random uuid the requesting device generated and kept. Exchanged for the request''s status via everything_request_status(). Null on requests from extension builds older than this migration.';

-- The insert policy from migration 077 pins status and item_id but does not
-- name columns, so a client may set client_token with no policy change.

-- 3. Exchange a token for that one request's status. Security definer, so it
--    reads a table clients cannot read; the where clause is what keeps it
--    narrow. The empty-token guard means a legacy row with a null token can
--    never be matched by passing null.
create or replace function everything_request_status(token uuid)
returns table (status text, status_reason text, item_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.status, r.status_reason, r.item_id
  from everything_note_requests r
  where token is not null and r.client_token = token
$$;

revoke execute on function everything_request_status(uuid) from public;
grant execute on function everything_request_status(uuid) to anon, authenticated;

-- 4. The intake service subscribes to request inserts with the service key, so
--    a request is noticed in about a second instead of at the next poll.
--    Realtime respects row level security, and this table has no select
--    policy, so clients on the anon key still receive nothing from it.
alter publication supabase_realtime add table everything_note_requests;

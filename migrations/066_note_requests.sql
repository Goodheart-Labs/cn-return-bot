-- everything_note_requests: a reader asked for a Common Note on a page the
-- extension doesn't cover yet ("Request a Common Note" context menu). Write-only
-- inbox for the team — clients can insert, never read. Anonymous requests are
-- allowed (user_id null); signed-in requests carry the requester.

create table everything_note_requests (
  id uuid primary key default gen_random_uuid(),
  page_url text not null check (char_length(page_url) <= 2048),
  page_title text not null default '' check (char_length(page_title) <= 512),
  selection text not null check (char_length(selection) between 1 and 2000),
  user_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table everything_note_requests enable row level security;

-- Insert-only: table grant (migration 050 revoked client defaults) plus the
-- RLS policy; no select/update/delete for clients.
grant insert on everything_note_requests to anon, authenticated;
create policy note_requests_insert on everything_note_requests
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

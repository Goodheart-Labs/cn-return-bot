-- 173: the review page on commonnotes.net can schedule a note on X.
--
-- Until now only the local posting tool (`bun run note-tweets`, GOO-629) could
-- send a note to Typefully, because sending needs the Typefully key and a
-- headless browser to take the note's picture. On commonnotes.net the Post on
-- X button was hidden. Now an admin's press there writes a request into
-- everything_x_post_requests. A worker on the team's server
-- (src/note-tweets/worker.ts) takes each pending request, makes the Typefully
-- draft in the next free slot of the account's queue, marks the note as
-- scheduled on X and closes the request. The worker uses the service key;
-- nobody else can write a request except through everything_request_x_post,
-- which only admins may call.
--
-- A request is 'pending' until the worker takes it, 'sending' while it works
-- on it, then 'sent' or 'failed' with the reason. A request whose draft
-- Typefully made stays 'sending' until the worker has marked the note, so it
-- never makes a second draft. One left 'sending' without a draft for ten
-- minutes, because the worker stopped halfway, is closed as failed by the
-- worker's next pass, so the note can be asked for again.
-- This migration only adds, so it goes live before the website that uses it.

create table everything_x_post_requests (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references everything_notes (id) on delete cascade,
  tweet_text text not null check (btrim(tweet_text) <> '' and char_length(tweet_text) <= 4000),
  reply_text text not null default '' check (char_length(reply_text) <= 4000),
  requested_by text not null check (requested_by in ('jim', 'nathan')),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  error text,
  claimed_at timestamptz,
  typefully_draft_id text,
  done_at timestamptz
);
-- One open request per note, so a double press cannot make two drafts.
create unique index everything_x_post_requests_one_open on everything_x_post_requests (note_id) where status in ('pending', 'sending');
comment on table everything_x_post_requests is
  'Requests from the review page to schedule a note on X through Typefully, which a worker on the team''s server carries out (migration 173).';

alter table everything_x_post_requests enable row level security;
revoke all on everything_x_post_requests from anon, authenticated;
grant all on everything_x_post_requests to service_role;
create policy x_post_requests_admin_read on everything_x_post_requests for select to authenticated using (everything_is_admin());
grant select on everything_x_post_requests to authenticated;

-- Asks the worker to schedule the note on X, and returns the request's id. Only
-- an admin may ask, and only for a note that is neither scheduled nor posted.
create function everything_request_x_post(p_note uuid, p_text text, p_reply text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
  v_id uuid;
begin
  if not everything_is_admin() then
    raise exception 'Only an admin can post a note on X';
  end if;
  v_actor := everything_claude_actor(null);
  if exists (select 1 from everything_note_x_marks where note_id = p_note and mark in ('scheduled', 'posted')) then
    raise exception 'This note is already scheduled or posted on X';
  end if;
  insert into everything_x_post_requests (note_id, tweet_text, reply_text, requested_by)
  values (p_note, p_text, coalesce(p_reply, ''), v_actor)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'This note is already on its way to Typefully';
end;
$$;

revoke all on function everything_request_x_post(uuid, text, text) from public, anon, authenticated;
grant execute on function everything_request_x_post(uuid, text, text) to authenticated;

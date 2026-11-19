-- The notewriter API (GOO-791). Replaces "one notewriter per post" with a list
-- of posts that notewriters reserve, gives every notewriter its own key, and
-- rebuilds the protocol of migration 168 on top of the new API.
--
-- The plan: https://claude.ai/artifact/NFvnCQqNchNyhF2KbNzS2y. The guide for
-- notewriters is docs/notewriter-api.md. The key table, the key header, the
-- error codes and the admin functions come from Nathan's PR #729.
--
-- What changes:
--
-- 1. The post list. Every post Common Notes has read stays in
--    everything_items. A post is listed while it was published in the last
--    14 days, or a reader asked about it. The list's order is: requested
--    posts first, then fewer reservations, then creators holding priority and
--    higher creator score, then newer. Every value of that order is copied
--    onto the post's row (the list_* columns), and two indexes in exactly that
--    order serve each page, as the notes feed does since migration 141.
--
-- 2. Reservations. A reservation is one notewriter's turn on one post
--    (everything_reservations). It counts while it is open and before its
--    deadline, and after it ended as done or skipped. A failed or expired one
--    does not count. A notewriter reserves a post only while fewer than
--    at_most reservations count on it. The row lock on the post makes the
--    count exact, so two notewriters can never both be first.
--
-- 3. API v2, the notewriter_api_* functions. Every call carries the
--    notewriter's own key in the X-Notewriter-Key header. Outside notewriters
--    call them with the website's public key. Errors come as HTTP statuses:
--    PostgREST turns the SQLSTATE PT401 into 401, and so on.
--
-- 4. API v1, the six notewriter_* functions of migration 168. Same names,
--    arguments and answers, now a few lines each on top of the reservations.
--    A v1 caller sees two changes: next_post never answers cooldown, because
--    there are no breaks after failures, and add_note fails unless the
--    notewriter holds the post. add_note also runs the checks every note gets
--    now (a passage of at least 20 characters that is in the post, at most
--    1,000 characters of note, 1 to 8 sources with web addresses), and a
--    passage that already has a note by someone else gets not_posted.
--
-- 5. Every assignment is copied into everything_reservations with the same id,
--    so a post a runner holds during the switch finishes normally. The old
--    table stays until migration 185 drops it, frozen from here on.
--
-- ORDER: apply right before merging the PR of GOO-791. The new code calls the
-- functions this migration adds. Code from before still runs against it: the
-- feed run's two queue functions are rewritten on the reservations below, and
-- the old table it reads is only frozen.
--
-- After applying: notify pgrst (at the end of this file) and run
-- `bun run gen-db-types`.

-- ---------------------------------------------------------------------------
-- 1. Notewriters, keys and reservations
-- ---------------------------------------------------------------------------

alter table everything_notewriters
  add column outside boolean not null default false,
  add column contact text,
  add column notes_per_day int check (notes_per_day > 0),
  add column max_open int check (max_open > 0),
  add column disabled_at timestamptz,
  add column disabled_reason text;
comment on column everything_notewriters.outside is
  'True for a notewriter someone outside the team runs. Its reservations do not count when our own notewriters list and reserve posts, so it adds coverage and never removes any.';
comment on column everything_notewriters.notes_per_day is
  'How many notes the notewriter may post in any 24 hours. Null for no limit.';
comment on column everything_notewriters.max_open is
  'How many open reservations the notewriter may hold at once. Null for no limit.';
comment on column everything_notewriters.disabled_at is
  'Set when an admin switched the notewriter off. Its key is refused while this is set.';
comment on column everything_notewriters.last_seen_at is
  'The notewriter''s last call: any v2 call, or v1''s next_post and subscribe. Slack hears when one of our own notewriters has not called for 30 minutes.';

-- In the 14 days to 2026-11-18 our runners finished 766 posts, at a median of
-- 2 minutes on hq and 8 on the ai-box, and the longest took 35 minutes.
alter table everything_notewriters alter column lease_minutes set default 120;
update everything_notewriters set lease_minutes = 120 where lease_minutes = 60;

create table everything_notewriter_keys (
  key_hash text primary key,
  notewriter_id text not null references everything_notewriters (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
comment on table everything_notewriter_keys is
  'Notewriter keys (GOO-791, from #729). Only the SHA-256 of a key is stored, so a key is shown once, when it is made.';
create index everything_notewriter_keys_by_notewriter on everything_notewriter_keys (notewriter_id);

create table everything_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items (id) on delete cascade,
  notewriter_id text not null references everything_notewriters (id),
  place int not null check (place > 0),
  requested boolean not null,
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  ended_at timestamptz,
  outcome text check (outcome in ('done', 'skipped', 'failed', 'expired')),
  reason text check (length(reason) <= 500),
  summary jsonb check (pg_column_size(summary) <= 10240),
  check ((ended_at is null) = (outcome is null))
);
comment on table everything_reservations is
  'One notewriter''s turn on one post (GOO-791). It counts while open and before its deadline, and after it ended as done or skipped. place is 1 for first, 2 for second, at the moment of reserving. requested says whether a reader had asked about the post then.';
create unique index everything_reservations_one_open on everything_reservations (item_id, notewriter_id) where ended_at is null;
create index everything_reservations_by_item on everything_reservations (item_id);
create index everything_reservations_by_notewriter on everything_reservations (notewriter_id, started_at desc);
create index everything_reservations_open_by_deadline on everything_reservations (deadline) where ended_at is null;

alter table everything_notewriter_keys enable row level security;
alter table everything_reservations enable row level security;
revoke all on everything_notewriter_keys, everything_reservations from anon, authenticated;

-- The devbox's dispatcher has been claude-ai-box until now. It gets its own
-- notewriter and key, so the ai-box runner's silence shows while the devbox
-- keeps calling.
insert into everything_notewriters (id, name, owner, lease_minutes) values
  ('claude-devbox', 'Claude on the devbox', 'Jim. The permanent Claude session on Jim''s devbox, on Jim''s plan.', 180);

-- Every assignment becomes a reservation with the same id, times and outcome.
-- It was the only notewriter on the post, so its place is 1.
insert into everything_reservations (id, item_id, notewriter_id, place, requested, started_at, deadline, ended_at, outcome, reason, summary)
select id, item_id, notewriter_id, 1, reader_request, started_at, deadline, ended_at, outcome, left(reason, 500),
       case when pg_column_size(summary) <= 10240 then summary end
  from everything_assignments;

-- A post checked before migration 168 has no assignment. It gets one done
-- reservation by the pipeline, so old checks count as looks.
insert into everything_reservations (item_id, notewriter_id, place, requested, started_at, deadline, ended_at, outcome)
select i.id, 'pipeline', 1, false, i.first_checked_at, i.first_checked_at, i.first_checked_at, 'done'
  from everything_items i
 where i.first_checked_at is not null
   and not exists (select 1 from everything_reservations r where r.item_id = i.id);

-- ---------------------------------------------------------------------------
-- 2. The list columns
-- ---------------------------------------------------------------------------

alter table everything_items
  add column requested_since timestamptz,
  add column demanded_at timestamptz,
  add column list_requested boolean not null default false,
  add column list_team_count int not null default 0,
  add column list_all_count int not null default 0,
  add column list_rank numeric not null default 0,
  add column list_date date,
  add column list_open boolean not null default false;
comment on column everything_items.requested_since is
  'When the oldest open reader request on the post came in, or an admin started its minisite fact-check. Null while nobody waits. Finishing the post clears it.';
comment on column everything_items.demanded_at is
  'When cn-walk added the page because several readers opened it (GOO-793). Such a page ranks like a post of a creator holding priority, and its 14 days in the list start then.';
comment on column everything_items.list_requested is 'Copy for the post list: requested_since is set.';
comment on column everything_items.list_team_count is
  'Copy for the post list: the counting reservations by our own notewriters, since requested_since when it is set.';
comment on column everything_items.list_all_count is 'Copy for the post list: the same as list_team_count, by every notewriter.';
comment on column everything_items.list_rank is
  'Copy for the post list: the creator''s list_rank, or a priority creator''s for a page readers opened.';
comment on column everything_items.list_date is
  'Copy for the post list: the day readers opened the page for a demanded page, else the publication day, else the day the post was added.';
comment on column everything_items.list_open is
  'Copy for the post list: the post is listed. It needs its text (and a video its caption timings), and either a list_date in the last 14 days or an open request.';

alter table everything_projects add column list_rank numeric not null default 0;
comment on column everything_projects.list_rank is
  'Where the creator''s posts go in the post list: 1000 plus the creator score while the creator holds priority, the creator score while the creator is walked on visits, else 0. cn-walk sets it every 10 minutes from the ranking it walks.';

-- How a creator holding priority ranks in the list. Creator scores are
-- averages of readers per post and stay far below it.
create function everything_priority_rank() returns numeric
language sql immutable set search_path = public as $$ select 1000::numeric $$;

-- The posts of the last this many days are listed. Older ones gave 2.2
-- Helpful notes per 100 posts in the 30 days to 2026-11-12, younger ones 17.
create function everything_list_days() returns int
language sql immutable set search_path = public as $$ select 14 $$;

-- A reservation counts while it is open and before its deadline, and after it
-- ended as done or skipped.
create function everything_reservation_counts(r everything_reservations) returns boolean
language sql stable set search_path = public as $$
  select r.outcome in ('done', 'skipped') or (r.ended_at is null and r.deadline > now())
$$;

-- The counting reservations on a post, by our own notewriters and by every
-- notewriter. On a requested post only those made since the request count, so
-- a post one notewriter checked last week goes back to the top when a reader
-- asks about it.
create function everything_item_reservation_counts(p_item uuid, p_since timestamptz, out team int, out everyone int)
language sql stable set search_path = public as $$
  select count(*) filter (where not w.outside)::int, count(*)::int
    from everything_reservations r join everything_notewriters w on w.id = r.notewriter_id
   where r.item_id = p_item and everything_reservation_counts(r)
     and r.started_at >= coalesce(p_since, '-infinity')
$$;

-- Keeps a post's list columns current. Before this migration a reader request
-- put a post at priority 2 of the queue (QUEUE_PRIORITY.requested), and the
-- minisite fact-check still does. So an item that enters the queue at that
-- tier counts as requested from now, until migration 185 drops the tiers.
-- Marking a post done ends its request, whoever marks it; notewriter_finish
-- sets a new requested_since in the same update when a later request waits.
create function everything_items_list_fields() returns trigger
language plpgsql set search_path = public as $$
declare
  v_counts record;
begin
  if new.status = 'queued' and new.priority >= 2
     and (tg_op = 'INSERT' or old.status is distinct from 'queued' or old.priority < 2) then
    new.requested_since := coalesce(new.requested_since, now());
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done'
     and new.requested_since is not distinct from old.requested_since then
    new.requested_since := null;
  end if;
  new.list_requested := new.requested_since is not null;
  new.list_date := coalesce(new.demanded_at::date, new.published_at, new.created_at::date);
  new.list_rank := coalesce((select p.list_rank from everything_projects p where p.id = new.project_id), 0);
  -- A page readers opened ranks like a post of its creator holding priority.
  if new.demanded_at is not null then
    new.list_rank := everything_priority_rank() + mod(new.list_rank, everything_priority_rank());
  end if;
  new.list_open := new.full_text is not null and (new.source <> 'youtube' or new.caption_cues is not null)
                   and (new.list_requested or new.list_date >= current_date - everything_list_days());
  if tg_op = 'INSERT' or new.requested_since is distinct from old.requested_since then
    select * into v_counts from everything_item_reservation_counts(new.id, new.requested_since);
    new.list_team_count := v_counts.team;
    new.list_all_count := v_counts.everyone;
  end if;
  return new;
end;
$$;
create trigger everything_items_list_fields before insert or update on everything_items
  for each row execute function everything_items_list_fields();

-- A reservation that starts, ends or is copied changes its post's counts.
create function everything_reservations_recount() returns trigger
language plpgsql set search_path = public as $$
declare
  v_counts record;
  v_since timestamptz;
begin
  select requested_since into v_since from everything_items where id = new.item_id;
  select * into v_counts from everything_item_reservation_counts(new.item_id, v_since);
  update everything_items set list_team_count = v_counts.team, list_all_count = v_counts.everyone
   where id = new.item_id and (list_team_count, list_all_count) is distinct from (v_counts.team, v_counts.everyone);
  return null;
end;
$$;
create trigger everything_reservations_recount after insert or update on everything_reservations
  for each row execute function everything_reservations_recount();

-- A creator's new rank reaches the posts that are listed. A post that is not
-- listed gets it when its row next changes, for example when it is requested.
create function everything_projects_rerank() returns trigger
language plpgsql set search_path = public as $$
begin
  update everything_items set list_rank = list_rank where project_id = new.id and list_open;
  return null;
end;
$$;
create trigger everything_projects_rerank after update of list_rank on everything_projects
  for each row when (old.list_rank is distinct from new.list_rank)
  execute function everything_projects_rerank();

-- The requests that wait now. A reader request moved the post to priority 2
-- and stays 'enqueued' while the post waits.
update everything_items i
   set requested_since = coalesce((select min(r.created_at) from everything_note_requests r
                                    where r.item_id = i.id and r.status = 'enqueued'), now())
 where i.status = 'queued' and i.priority >= 2;
-- The pages the feed run queued because readers opened them (migration 183).
update everything_items i set demanded_at = q.queued_at
  from everything_demand_queued q
 where q.queued and everything_visit_page(i.url) = q.page_url and i.demanded_at is null;
-- Fills every post's list columns through the trigger. The notes trigger of
-- migration 141 is not touched, because no note changes here.
update everything_items set list_date = null;
-- The reservations copied above came before their trigger, so their counts
-- are filled here.
update everything_items i set list_team_count = c.team, list_all_count = c.everyone
  from everything_items x cross join lateral everything_item_reservation_counts(x.id, x.requested_since) c
 where x.id = i.id and (c.team, c.everyone) <> (0, 0);

-- The list's order, one index per count. Each sorts ascending on every
-- column, so a page after a given post is one row comparison and one range
-- scan: requested first (false before true), then fewer reservations, then
-- higher rank and newer day (negated), then the id.
create index everything_items_list_team on everything_items
  ((not list_requested), list_team_count, (- list_rank), ((date '2000-01-01' - list_date)), id) where list_open;
create index everything_items_list_all on everything_items
  ((not list_requested), list_all_count, (- list_rank), ((date '2000-01-01' - list_date)), id) where list_open;
-- What cn-walk's tidy-up looks for every 5 minutes: listed posts that turned
-- 14 days old.
create index everything_items_list_open_by_date on everything_items (list_date) where list_open and not list_requested;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- The notewriter whose key is in the X-Notewriter-Key header. Every v2 call
-- starts here, and it is the call's sign of life.
create function everything_notewriter_from_key() returns everything_notewriters
language plpgsql set search_path = public as $$
declare
  v_key text := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-notewriter-key', '')), '');
  v_id text;
  w everything_notewriters;
begin
  if v_key is null then
    raise exception 'Send your notewriter key in the X-Notewriter-Key header' using errcode = 'PT401';
  end if;
  update everything_notewriter_keys set last_used_at = now()
   where key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex') and revoked_at is null
  returning notewriter_id into v_id;
  if not found then
    raise exception 'This notewriter key is not valid' using errcode = 'PT401';
  end if;
  update everything_notewriters set last_seen_at = now() where id = v_id returning * into w;
  if w.disabled_at is not null then
    raise exception 'The notewriter % is switched off: %', w.id, coalesce(w.disabled_reason, 'no reason given') using errcode = 'PT403';
  end if;
  return w;
end;
$$;

-- Makes a new key and returns it. This is the only moment the key itself
-- exists in the database.
create function everything_notewriter_new_key(p_notewriter text) returns text
language plpgsql set search_path = public as $$
declare
  v_key text := 'cnw_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into everything_notewriter_keys (key_hash, notewriter_id)
  values (encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), p_notewriter);
  return v_key;
end;
$$;

-- The passages readers asked about that wait for an answer.
create function everything_asked_passages(p_item uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('request', r.id, 'passage', r.selection, 'reason', r.steer) order by r.created_at), '[]')
    from everything_note_requests r
   where r.item_id = p_item and r.status = 'enqueued' and r.status_reason = 'checking the selected passage' and r.selection is not null
$$;

-- A post as a notewriter reads it: its text, a video's caption timings, and
-- the passages readers asked about. only_asked_passages is true when the post
-- was already checked in full, so only those passages need checking.
create function everything_post_for_notewriter(i everything_items) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'url', i.url, 'title', i.title, 'source', i.source,
    'creator', (select p.name from everything_projects p where p.id = i.project_id),
    'published_at', i.published_at, 'requested', i.list_requested,
    'text', i.full_text, 'caption_cues', i.caption_cues,
    'asked_passages', asked.passages,
    'only_asked_passages', jsonb_array_length(asked.passages) > 0 and i.checked_scope = 'page' and i.first_checked_at is not null)
    from (select everything_asked_passages(i.id) as passages) asked
$$;

-- The list's sort key of a post, which pages are compared by. It is the same
-- tuple both indexes sort on, with the count of the given scope.
create function everything_list_key(i everything_items, p_team boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_array(case when i.list_requested then 0 else 1 end,
                           case when p_team then i.list_team_count else i.list_all_count end,
                           - i.list_rank, date '2000-01-01' - i.list_date, i.id)
$$;

-- One page of the list for a notewriter. It leaves out the posts the
-- notewriter holds or finished since the post's request, and every post it
-- failed on. So on a listed post every counting reservation is another
-- notewriter's. p_team counts only our own notewriters' reservations.
-- p_tier picks requested posts only ('requested'), unrequested ones only
-- ('feed'), or both (null).
create function everything_list_page(p_notewriter text, p_limit int, p_after jsonb, p_max_others int, p_team boolean, p_tier text, p_url text)
returns setof everything_items
language plpgsql stable set search_path = public as $$
declare
  a_tier boolean := case when p_after is null then false else (p_after ->> 0)::int = 1 end;
  a_count int := coalesce((p_after ->> 1)::int, -1);
  a_rank numeric := coalesce((p_after ->> 2)::numeric, '-infinity'::numeric);
  a_day int := coalesce((p_after ->> 3)::int, -2147483648);
  a_id uuid := coalesce((p_after ->> 4)::uuid, '00000000-0000-0000-0000-000000000000');
begin
  if p_team then
    return query
    select i.* from everything_items i
     where i.list_open
       and ((not i.list_requested), i.list_team_count, (- i.list_rank), (date '2000-01-01' - i.list_date), i.id) > (a_tier, a_count, a_rank, a_day, a_id)
       and i.list_team_count <= p_max_others
       and (p_tier is null or i.list_requested = (p_tier = 'requested'))
       and (p_url is null or i.url = p_url)
       and not exists (select 1 from everything_reservations r
                        where r.item_id = i.id and r.notewriter_id = p_notewriter
                          and (r.outcome in ('failed', 'expired') or r.ended_at is null
                               or r.started_at >= coalesce(i.requested_since, '-infinity')))
     order by (not i.list_requested), i.list_team_count, (- i.list_rank), (date '2000-01-01' - i.list_date), i.id
     limit p_limit;
  else
    return query
    select i.* from everything_items i
     where i.list_open
       and ((not i.list_requested), i.list_all_count, (- i.list_rank), (date '2000-01-01' - i.list_date), i.id) > (a_tier, a_count, a_rank, a_day, a_id)
       and i.list_all_count <= p_max_others
       and (p_tier is null or i.list_requested = (p_tier = 'requested'))
       and (p_url is null or i.url = p_url)
       and not exists (select 1 from everything_reservations r
                        where r.item_id = i.id and r.notewriter_id = p_notewriter
                          and (r.outcome in ('failed', 'expired') or r.ended_at is null
                               or r.started_at >= coalesce(i.requested_since, '-infinity')))
     order by (not i.list_requested), i.list_all_count, (- i.list_rank), (date '2000-01-01' - i.list_date), i.id
     limit p_limit;
  end if;
end;
$$;

-- Reserves a post for a notewriter if fewer than p_at_most reservations
-- count on it now. Our own notewriters count only each other, so an outside
-- notewriter never takes a post away from them. An outside notewriter counts
-- everyone. The place is the post's counting reservations by everyone plus
-- one. The post's row stays locked until the call ends, so two reserves of
-- one post are counted one after the other.
create function everything_reserve(w everything_notewriters, p_item uuid, p_at_most int) returns jsonb
language plpgsql set search_path = public as $$
declare
  i everything_items;
  v_counts record;
  r everything_reservations;
begin
  if p_at_most is null or p_at_most < 1 then
    raise exception 'at_most must be 1 or more' using errcode = 'PT400';
  end if;
  select * into i from everything_items where id = p_item for update;
  if not found then raise exception 'There is no post %', p_item using errcode = 'PT404'; end if;
  if i.full_text is null or (i.source = 'youtube' and i.caption_cues is null) then
    raise exception 'Common Notes has not read post % yet', p_item using errcode = 'PT404';
  end if;
  if exists (select 1 from everything_reservations where item_id = i.id and notewriter_id = w.id and ended_at is null and deadline > now()) then
    raise exception 'You already hold post %. Finish or fail that reservation first.', p_item using errcode = 'PT409';
  end if;
  if w.max_open is not null and (select count(*) from everything_reservations
                                   where notewriter_id = w.id and ended_at is null and deadline > now()) >= w.max_open then
    raise exception 'The notewriter % may hold % posts at once and holds them. Finish or fail one first.', w.id, w.max_open using errcode = 'PT429';
  end if;
  -- An open reservation of this notewriter whose deadline passed blocks the
  -- unique index, so it ends now as expired.
  update everything_reservations set ended_at = now(), outcome = 'expired', reason = 'The deadline passed without an answer'
   where item_id = i.id and notewriter_id = w.id and ended_at is null;
  select * into v_counts from everything_item_reservation_counts(i.id, i.requested_since);
  if (case when w.outside then v_counts.everyone else v_counts.team end) >= p_at_most then
    return jsonb_build_object('kind', 'taken', 'reservations', case when w.outside then v_counts.everyone else v_counts.team end);
  end if;
  insert into everything_reservations (item_id, notewriter_id, place, requested, deadline)
  values (i.id, w.id, v_counts.everyone + 1, i.list_requested, now() + make_interval(mins => w.lease_minutes))
  returning * into r;
  return jsonb_build_object('kind', 'reserved', 'reservation', r.id, 'place', r.place, 'deadline', r.deadline,
                            'post', everything_post_for_notewriter(i));
end;
$$;

-- The open reservation, locked, when it belongs to the notewriter and its
-- deadline has not passed.
create function everything_open_reservation(p_reservation uuid, p_notewriter text) returns everything_reservations
language plpgsql set search_path = public as $$
declare
  r everything_reservations;
begin
  select * into r from everything_reservations where id = p_reservation for update;
  if not found then raise exception 'There is no reservation %', p_reservation using errcode = 'PT404'; end if;
  if p_notewriter is not null and r.notewriter_id <> p_notewriter then
    raise exception 'Reservation % is not yours', p_reservation using errcode = 'PT403';
  end if;
  if r.ended_at is not null then
    raise exception 'Reservation % already ended as %', p_reservation, r.outcome using errcode = 'PT409';
  end if;
  if r.deadline <= now() then
    raise exception 'The deadline of reservation % passed at %. Notes posted before stay up.', p_reservation, r.deadline using errcode = 'PT409';
  end if;
  return r;
end;
$$;

-- Ends a reservation as done, or as skipped with a reason. When one of our own
-- notewriters finishes, every passage a reader asked about before the
-- reservation started gets its answer, and the post is marked done. A request
-- that came in while it worked keeps the post requested. An outside
-- notewriter's finish answers no reader.
create function everything_finish_reservation(r everything_reservations, p_summary jsonb, p_skip_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare
  w everything_notewriters;
  v_answered int := 0;
  v_later timestamptz;
begin
  if length(p_skip_reason) > 500 then raise exception 'A skip reason has at most 500 characters' using errcode = 'PT400'; end if;
  if pg_column_size(p_summary) > 10240 then raise exception 'A summary has at most 10 KB' using errcode = 'PT400'; end if;
  select * into w from everything_notewriters where id = r.notewriter_id;
  update everything_reservations
     set ended_at = now(), outcome = case when p_skip_reason is null then 'done' else 'skipped' end,
         reason = p_skip_reason, summary = p_summary
   where id = r.id;
  if w.outside then return jsonb_build_object('answered', 0, 'post', 'done'); end if;
  update everything_note_requests q
     set status = 'done',
         status_reason = case when exists (
           select 1 from everything_claims c join everything_notes n on n.claim_id = c.id
            where c.item_id = r.item_id and n.created_at >= r.started_at
              and everything_passages_overlap(coalesce(c.context_quote, c.claim), q.selection))
           then 'the selected passage got a note' else 'the selected passage needs no note' end
   where q.item_id = r.item_id and q.status = 'enqueued' and q.status_reason = 'checking the selected passage'
     and q.selection is not null and q.created_at <= r.started_at;
  get diagnostics v_answered = row_count;
  select min(q.created_at) into v_later from everything_note_requests q
   where q.item_id = r.item_id and q.status = 'enqueued' and q.status_reason = 'checking the selected passage'
     and q.selection is not null;
  update everything_items
     set status = case when v_later is null then 'done' else 'queued' end,
         requested_since = v_later,
         error = null, progress = null, skip_reason = p_skip_reason, processed_at = now()
   where id = r.item_id;
  return jsonb_build_object('answered', v_answered, 'post', case when v_later is null then 'done' else 'back_in_queue' end);
end;
$$;

-- Ends a reservation as failed or expired. The post stays listed for every
-- other notewriter and is never listed to this one again. A requested post
-- that none of our notewriters taking reader requests can still take is
-- marked failed, so the reader does not wait forever.
create function everything_fail_reservation(r everything_reservations, p_outcome text, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare
  i everything_items;
begin
  update everything_reservations set ended_at = now(), outcome = p_outcome, reason = left(p_reason, 500) where id = r.id;
  select * into i from everything_items where id = r.item_id for update;
  if i.requested_since is not null and not exists (
       select 1 from everything_notewriters w
        where w.takes_reader_requests and not w.outside and w.disabled_at is null
          and not exists (select 1 from everything_reservations f
                           where f.item_id = i.id and f.notewriter_id = w.id and f.outcome in ('failed', 'expired')
                             and f.started_at >= i.requested_since)) then
    update everything_items
       set status = 'error', error = 'Every notewriter that takes reader requests failed on it. The last failure: ' || p_reason,
           requested_since = null, progress = null, processed_at = now()
     where id = i.id;
    return jsonb_build_object('post', 'failed');
  end if;
  return jsonb_build_object('post', 'back_in_queue');
end;
$$;

-- Posts one note for a notewriter on a post, with every check a note gets.
-- Callers check the reservation first; the review page's publish posts a
-- reviewer's text without one. The answer is posted, or not_posted with a
-- reason. A not_posted with own = true means the notewriter itself already
-- wrote a note on that passage, which API v2 answers with 409.
--
-- p_note: passage, note, sources [{url, quote, explanation}], start_seconds,
-- end_seconds, context_url, and claim: a claim of the post without a note,
-- which the pipeline passes so the note hangs on its own extracted claim.
create function everything_post_note(p_notewriter text, p_item uuid, p_note jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  min_passage constant int := 20;
  max_passage constant int := 3000;
  max_note constant int := 1000;
  max_sources constant int := 8;
  max_source_field constant int := 1500;
  w everything_notewriters;
  i everything_items;
  v_passage text := btrim(coalesce(p_note ->> 'passage', ''));
  v_text text := btrim(coalesce(p_note ->> 'note', ''));
  v_sources jsonb := coalesce(p_note -> 'sources', '[]');
  v_start jsonb := coalesce(p_note -> 'start_seconds', 'null');
  v_end jsonb := coalesce(p_note -> 'end_seconds', 'null');
  v_length numeric;
  v_existing record;
  v_claim uuid := (p_note ->> 'claim')::uuid;
  v_note uuid;
begin
  -- One note of a notewriter at a time, so two calls cannot both take the
  -- last note of the day.
  select * into w from everything_notewriters where id = p_notewriter for update;
  if not found then raise exception 'There is no notewriter %', p_notewriter using errcode = 'PT404'; end if;
  select * into i from everything_items where id = p_item;
  if not found or i.full_text is null then
    raise exception 'Common Notes has not read post %', p_item using errcode = 'PT404';
  end if;
  if w.notes_per_day is not null and (select count(*) from everything_notes n
                                        where n.notewriter_id = w.id and n.created_at > now() - interval '24 hours') >= w.notes_per_day then
    raise exception 'The notewriter % may post % notes in any 24 hours and has posted them', w.id, w.notes_per_day using errcode = 'PT429';
  end if;
  if length(v_passage) < min_passage or length(v_passage) > max_passage then
    raise exception 'A note needs the passage of the post it is about, % to % characters', min_passage, max_passage using errcode = 'PT400';
  end if;
  if position(btrim(regexp_replace(lower(v_passage), '\s+', ' ', 'g')) in regexp_replace(lower(i.full_text), '\s+', ' ', 'g')) = 0 then
    raise exception 'The passage is not in the post. Copy it exactly from the post''s text.' using errcode = 'PT400';
  end if;
  if v_text = '' or length(v_text) > max_note then
    raise exception 'A note needs its text, at most % characters', max_note using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) not between 1 and max_sources
     or exists (select 1 from jsonb_array_elements(v_sources) s
                 where jsonb_typeof(s) <> 'object'
                    or coalesce(s ->> 'url', '') !~* '^https?://[^\s]+$'
                    or length(s ->> 'url') > max_source_field
                    or length(coalesce(s ->> 'quote', '')) > max_source_field
                    or length(coalesce(s ->> 'explanation', '')) > max_source_field) then
    raise exception 'A note needs 1 to % sources, each with a url that starts with http:// or https://, and no field over % characters', max_sources, max_source_field using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_start) not in ('number', 'null') or jsonb_typeof(v_end) not in ('number', 'null') then
    raise exception 'start_seconds and end_seconds are whole seconds, or left out' using errcode = 'PT400';
  end if;
  if v_start <> 'null' or v_end <> 'null' then
    select max((c ->> 'end')::numeric) into v_length from jsonb_array_elements(coalesce(i.caption_cues, '[]')) c;
    if (v_start <> 'null' and ((v_start #>> '{}')::numeric <> trunc((v_start #>> '{}')::numeric) or (v_start #>> '{}')::numeric not between 0 and coalesce(ceil(v_length), 0)))
       or (v_end <> 'null' and ((v_end #>> '{}')::numeric <> trunc((v_end #>> '{}')::numeric) or (v_end #>> '{}')::numeric not between 0 and coalesce(ceil(v_length), 0)))
       or (v_start <> 'null' and v_end <> 'null' and (v_end #>> '{}')::numeric < (v_start #>> '{}')::numeric) then
      raise exception 'Video timings are whole seconds from 0 to the video''s length (% seconds), and the end is not before the start', coalesce(ceil(v_length), 0) using errcode = 'PT400';
    end if;
  end if;
  if v_claim is not null and not exists (
       select 1 from everything_claims c where c.id = v_claim and c.item_id = i.id
          and not exists (select 1 from everything_notes n where n.claim_id = c.id)) then
    raise exception 'Claim % is not a claim of post % without a note', v_claim, p_item using errcode = 'PT400';
  end if;
  -- The first note on a passage wins.
  select n.notewriter_id, n.author_id, n.author_name into v_existing
    from everything_claims c join everything_notes n on n.claim_id = c.id
   where c.item_id = i.id and everything_passages_overlap(coalesce(c.context_quote, c.claim), v_passage)
   order by (n.notewriter_id is not distinct from w.id) desc, n.created_at
   limit 1;
  if found then
    return jsonb_build_object('kind', 'not_posted', 'own', v_existing.notewriter_id is not distinct from w.id,
      'reason', case
        when v_existing.notewriter_id is not distinct from w.id then 'You already wrote a note on this passage'
        when v_existing.author_id is not null then coalesce(v_existing.author_name, 'A person') || ' already wrote a note on this passage'
        else 'Another notewriter already wrote a note on this passage' end);
  end if;
  if v_claim is null then
    insert into everything_claims (item_id, claim, judgement, context_quote, context_url, start_seconds, end_seconds, status)
    values (i.id, left(v_passage, 300), 'notewriter', v_passage,
            coalesce(p_note ->> 'context_url', i.url),
            (v_start #>> '{}')::numeric::int, (v_end #>> '{}')::numeric::int, 'note')
    returning id into v_claim;
  end if;
  insert into everything_notes (claim_id, note, notewriter_id)
  values (v_claim, v_text, w.id)
  returning id into v_note;
  insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
  select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
    from jsonb_array_elements(v_sources) with ordinality as t(s, n);
  return jsonb_build_object('kind', 'posted', 'note', v_note, 'claim', v_claim);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Health
-- ---------------------------------------------------------------------------

-- Every notewriter's numbers, counted fresh on each read. An expired
-- reservation is one that ended as expired, or is still open past its
-- deadline, which cn-walk ends within 5 minutes.
create view everything_notewriter_health with (security_invoker = true) as
select w.id, w.name, w.owner, w.outside, w.disabled_at, w.every_minutes, w.takes_reader_requests,
       w.lease_minutes, w.notes_per_day, w.max_open, w.last_seen_at,
       (select count(*)::int from everything_reservations r where r.notewriter_id = w.id and r.ended_at is null and r.deadline > now()) as open_reservations,
       (select count(*)::int from everything_reservations r where r.notewriter_id = w.id and r.outcome = 'done' and r.ended_at > now() - interval '7 days') as done_7d,
       (select count(*)::int from everything_reservations r where r.notewriter_id = w.id and r.outcome = 'skipped' and r.ended_at > now() - interval '7 days') as skipped_7d,
       (select count(*)::int from everything_reservations r where r.notewriter_id = w.id and r.outcome = 'failed' and r.ended_at > now() - interval '7 days') as failed_7d,
       (select count(*)::int from everything_reservations r where r.notewriter_id = w.id and r.started_at > now() - interval '7 days'
           and (r.outcome = 'expired' or (r.ended_at is null and r.deadline <= now()))) as expired_7d,
       (select count(*)::int from everything_notes n where n.notewriter_id = w.id and n.created_at > now() - interval '7 days') as notes_7d,
       (select count(*)::int from everything_notes n where n.notewriter_id = w.id) as notes_total,
       f.reason as last_failure, f.ended_at as last_failure_at
  from everything_notewriters w
  left join lateral (select r.reason, r.ended_at from everything_reservations r
                      where r.notewriter_id = w.id and r.outcome in ('failed', 'expired')
                      order by r.ended_at desc limit 1) f on true;
comment on view everything_notewriter_health is
  'Each notewriter''s numbers (GOO-791): open reservations, done, skipped, failed and expired in 7 days, notes in 7 days and in all, and its last failure. notewriter_api_me and the admin dashboard read it.';
revoke all on everything_notewriter_health from anon, authenticated;

-- A notewriter's last 5 failed or expired reservations.
create function everything_notewriter_last_failures(p_notewriter text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(f order by f.at desc), '[]')
    from (select r.ended_at as at, i.url, r.outcome, r.reason
            from everything_reservations r join everything_items i on i.id = r.item_id
           where r.notewriter_id = p_notewriter and r.outcome in ('failed', 'expired')
           order by r.ended_at desc limit 5) f
$$;

-- The dashboard's Notewriters section. Admins only.
drop function everything_notewriters_overview();
create function everything_notewriters_overview()
returns table (id text, name text, owner text, outside boolean, disabled_at timestamptz, every_minutes int, takes_reader_requests boolean,
               lease_minutes int, notes_per_day int, max_open int, last_seen_at timestamptz, open_reservations int,
               done_7d int, skipped_7d int, failed_7d int, expired_7d int, notes_7d int, notes_total int,
               last_failure text, last_failure_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not everything_is_admin() then raise exception 'Only admins can see the notewriters'; end if;
  return query
  select h.id, h.name, h.owner, h.outside, h.disabled_at, h.every_minutes, h.takes_reader_requests,
         h.lease_minutes, h.notes_per_day, h.max_open, h.last_seen_at, h.open_reservations,
         h.done_7d, h.skipped_7d, h.failed_7d, h.expired_7d, h.notes_7d, h.notes_total,
         h.last_failure, h.last_failure_at
    from everything_notewriter_health h
    join everything_notewriters w on w.id = h.id
   order by w.outside, w.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. API v2: the website's public key plus a notewriter key
-- ---------------------------------------------------------------------------

-- The notewriter's name, its limits, how many notes it may still post, its
-- open reservations and its health numbers. Also its sign of life.
create function notewriter_api_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  h everything_notewriter_health;
begin
  select * into h from everything_notewriter_health where id = w.id;
  return jsonb_build_object(
    'notewriter', jsonb_build_object('id', w.id, 'name', w.name),
    'limits', jsonb_build_object('notes_per_day', w.notes_per_day, 'max_open', w.max_open, 'lease_minutes', w.lease_minutes),
    'notes_left', case when w.notes_per_day is null then null
                       else greatest(w.notes_per_day - (select count(*) from everything_notes n
                                                          where n.notewriter_id = w.id and n.created_at > now() - interval '24 hours'), 0) end,
    'open', (select coalesce(jsonb_agg(jsonb_build_object('reservation', r.id, 'post', r.item_id, 'url', i.url, 'deadline', r.deadline)
                                       order by r.started_at), '[]')
               from everything_reservations r join everything_items i on i.id = r.item_id
              where r.notewriter_id = w.id and r.ended_at is null and r.deadline > now()),
    'last_7_days', jsonb_build_object('done', h.done_7d, 'skipped', h.skipped_7d, 'failed', h.failed_7d,
                                      'expired', h.expired_7d, 'notes', h.notes_7d),
    'last_call', w.last_seen_at,
    'last_failures', everything_notewriter_last_failures(w.id));
end;
$$;

-- A page of the list. max_others bounds the reservations of other
-- notewriters on a listed post; the default lists only posts nobody counts
-- on. others_from 'team' counts only our own notewriters. An outside
-- notewriter is never listed requested posts. next goes back as after for
-- the following page.
create function notewriter_api_posts(p_limit int default 1, p_after jsonb default null, p_max_others int default 0,
                                     p_others_from text default 'everyone', p_requested_only boolean default false,
                                     p_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  max_limit constant int := 50;
  w everything_notewriters := everything_notewriter_from_key();
  v_team boolean;
  v_tier text := case when p_requested_only then 'requested' end;
  v_posts jsonb;
  v_last everything_items;
  v_count int := 0;
  i everything_items;
begin
  if p_others_from not in ('everyone', 'team') then
    raise exception 'others_from is everyone or team' using errcode = 'PT400';
  end if;
  if p_limit is null or p_limit not between 1 and max_limit then
    raise exception 'limit is 1 to %', max_limit using errcode = 'PT400';
  end if;
  if p_max_others is null or p_max_others < 0 then
    raise exception 'max_others is 0 or more' using errcode = 'PT400';
  end if;
  if p_after is not null and (jsonb_typeof(p_after) <> 'array' or jsonb_array_length(p_after) <> 5) then
    raise exception 'after is the next of the page before' using errcode = 'PT400';
  end if;
  v_team := p_others_from = 'team';
  if w.outside then
    if p_requested_only then return jsonb_build_object('posts', '[]'::jsonb, 'next', null); end if;
    v_tier := 'feed';
  end if;
  v_posts := '[]';
  for i in select * from everything_list_page(w.id, p_limit, p_after, p_max_others, v_team, v_tier, nullif(btrim(p_url), '')) loop
    v_posts := v_posts || jsonb_build_object(
      'id', i.id, 'url', i.url, 'title', i.title, 'source', i.source,
      'creator', (select p.name from everything_projects p where p.id = i.project_id),
      'creator_priority', i.list_rank >= everything_priority_rank(),
      'creator_score', round(mod(i.list_rank, everything_priority_rank()), 2),
      'published_at', i.published_at, 'requested', i.list_requested,
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object(
                          'notewriter', r.notewriter_id, 'place', r.place,
                          'state', coalesce(r.outcome, 'open')) order by r.started_at), '[]')
                         from everything_reservations r
                        where r.item_id = i.id and everything_reservation_counts(r)
                          and r.started_at >= coalesce(i.requested_since, '-infinity')));
    v_last := i;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('posts', v_posts,
                            'next', case when v_count = p_limit then everything_list_key(v_last, v_team) end);
end;
$$;

-- One post with its text, by its id or its address. Needs no reservation.
create function notewriter_api_post(p_post uuid default null, p_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  i everything_items;
begin
  if p_post is not null then
    select * into i from everything_items where id = p_post;
  else
    select * into i from everything_items where url = btrim(p_url) and full_text is not null order by created_at desc limit 1;
  end if;
  if not found or i.full_text is null then
    raise exception 'Common Notes has not read this post. Only posts it has read can get notes.' using errcode = 'PT404';
  end if;
  return everything_post_for_notewriter(i);
end;
$$;

create function notewriter_api_reserve(p_post uuid, p_at_most int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return everything_reserve(everything_notewriter_from_key(), p_post, p_at_most);
end;
$$;

create function notewriter_api_finish(p_reservation uuid, p_summary jsonb default null, p_skip_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
begin
  return everything_finish_reservation(everything_open_reservation(p_reservation, w.id), p_summary, nullif(btrim(p_skip_reason), '')) - 'post';
end;
$$;

create function notewriter_api_fail(p_reservation uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  r everything_reservations;
begin
  if btrim(coalesce(p_reason, '')) = '' or length(p_reason) > 500 then
    raise exception 'A failure needs its reason, at most 500 characters' using errcode = 'PT400';
  end if;
  r := everything_open_reservation(p_reservation, w.id);
  perform everything_fail_reservation(r, 'failed', p_reason);
  return '{}'::jsonb;
end;
$$;

-- Posts one note on the post of a reservation the notewriter holds. Only the
-- fields named here reach the note, whatever else was sent.
create function notewriter_api_add_note(p_reservation uuid, p_note jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  r everything_reservations;
  v_answer jsonb;
begin
  if jsonb_typeof(p_note) is distinct from 'object' then
    raise exception 'note is an object: passage, note, sources, and start_seconds and end_seconds for a video' using errcode = 'PT400';
  end if;
  r := everything_open_reservation(p_reservation, w.id);
  v_answer := everything_post_note(w.id, r.item_id, jsonb_build_object(
    'passage', p_note -> 'passage', 'note', p_note -> 'note', 'sources', p_note -> 'sources',
    'start_seconds', p_note -> 'start_seconds', 'end_seconds', p_note -> 'end_seconds'));
  if (v_answer ->> 'own')::boolean then
    raise exception 'You already wrote a note on this passage' using errcode = 'PT409';
  end if;
  return v_answer - 'own' - 'claim';
end;
$$;

-- The notewriter's own notes, newest first, with readers' votes. A note
-- deleted from the site is not listed.
create function notewriter_api_notes(p_limit int default 50, p_after jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  max_limit constant int := 200;
  w everything_notewriters := everything_notewriter_from_key();
  v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and max_limit then
    raise exception 'limit is 1 to %', max_limit using errcode = 'PT400';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.note desc), '[]') into v_rows
    from (select n.id as note, n.created_at, i.id as post, i.url, c.context_quote as passage, n.note as text,
                 n.helpful_count as helpful, n.somewhat_helpful_count as somewhat_helpful, n.not_helpful_count as not_helpful
            from everything_notes n
            join everything_claims c on c.id = n.claim_id
            join everything_items i on i.id = c.item_id
           where n.notewriter_id = w.id
             and (p_after is null or (n.created_at, n.id) < ((p_after ->> 0)::timestamptz, (p_after ->> 1)::uuid))
           order by n.created_at desc, n.id desc
           limit p_limit) x;
  return jsonb_build_object('notes', v_rows,
    'next', case when jsonb_array_length(v_rows) = p_limit
                 then jsonb_build_array(v_rows -> -1 ->> 'created_at', v_rows -> -1 ->> 'note') end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. API v1, the protocol of migration 168, on top of the reservations
-- ---------------------------------------------------------------------------

-- The v1 answer for a reservation it made.
create function everything_v1_post(p_reserved jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'kind', 'post',
    'assignment', p_reserved ->> 'reservation',
    'deadline', p_reserved -> 'deadline',
    'reader_request', p_reserved -> 'post' -> 'requested',
    'item', (p_reserved -> 'post') - 'asked_passages' - 'only_asked_passages' - 'requested',
    'asked_passages', p_reserved -> 'post' -> 'asked_passages',
    'only_asked_passages', p_reserved -> 'post' -> 'only_asked_passages')
$$;

-- Reserves the top post of the list for a v1 notewriter, among the posts no
-- other notewriter of the team counts on. Another v1 or v2 notewriter may win
-- the race for a post between the listing and the reserve, so it tries the
-- next few posts.
create function everything_v1_take(w everything_notewriters, p_tier text) returns jsonb
language plpgsql set search_path = public as $$
declare
  tries constant int := 5;
  i everything_items;
  v_answer jsonb;
begin
  for i in select * from everything_list_page(w.id, tries, null, 0, true, p_tier, null) loop
    v_answer := everything_reserve(w, i.id, 1);
    if v_answer ->> 'kind' = 'reserved' then return everything_v1_post(v_answer); end if;
  end loop;
  return null;
end;
$$;

-- Called whenever a notewriter has room for one more post. A notewriter that
-- takes reader requests gets the top requested post first. Otherwise, once
-- every_minutes passed since its last feed post, it gets the top feed post.
drop function notewriter_next_post(text);
create function notewriter_next_post(p_notewriter text) returns jsonb
language plpgsql set search_path = public as $$
declare
  -- cn-walk adds posts as soon as they are published.
  ask_again_when_empty constant interval := interval '1 minute';
  w everything_notewriters;
  v_due timestamptz;
  v_answer jsonb;
begin
  update everything_notewriters set last_seen_at = now() where id = p_notewriter returning * into w;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  if w.disabled_at is not null then
    raise exception 'The notewriter % is switched off: %', w.id, coalesce(w.disabled_reason, 'no reason given') using errcode = 'PT403';
  end if;
  if w.takes_reader_requests then
    v_answer := everything_v1_take(w, 'requested');
    if v_answer is not null then return v_answer; end if;
  end if;
  if w.every_minutes is null then
    return jsonb_build_object('kind', 'wait', 'until', null, 'reason', 'unsubscribed');
  end if;
  select max(r.started_at) + make_interval(mins => w.every_minutes) into v_due
    from everything_reservations r where r.notewriter_id = w.id and not r.requested;
  if v_due > now() then
    return jsonb_build_object('kind', 'wait', 'until', v_due, 'reason', 'not_due');
  end if;
  v_answer := everything_v1_take(w, 'feed');
  if v_answer is not null then return v_answer; end if;
  return jsonb_build_object('kind', 'wait', 'until', now() + ask_again_when_empty, 'reason', 'queue_empty');
end;
$$;

-- Posts one note on a post the notewriter holds.
drop function notewriter_add_note(text, uuid, jsonb);
create function notewriter_add_note(p_notewriter text, p_item uuid, p_note jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reservation uuid;
begin
  select r.id into v_reservation from everything_reservations r
   where r.item_id = p_item and r.notewriter_id = p_notewriter and r.ended_at is null and r.deadline > now();
  if not found then
    raise exception 'The notewriter % holds no reservation on post %. Reserve it first.', p_notewriter, p_item using errcode = 'PT403';
  end if;
  perform everything_open_reservation(v_reservation, p_notewriter);
  return everything_post_note(p_notewriter, p_item, p_note) - 'own';
end;
$$;

drop function notewriter_finish(uuid, jsonb, text);
create function notewriter_finish(p_assignment uuid, p_summary jsonb default null, p_skip_reason text default null) returns jsonb
language plpgsql set search_path = public as $$
begin
  return jsonb_build_object('post', everything_finish_reservation(everything_open_reservation(p_assignment, null), p_summary, p_skip_reason) ->> 'post');
end;
$$;

-- A v1 caller reads cooldown_until. There are no breaks, so it is null.
drop function notewriter_fail(uuid, text);
create function notewriter_fail(p_assignment uuid, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'A failure needs its reason' using errcode = 'PT400'; end if;
  return jsonb_build_object('cooldown_until', null)
      || everything_fail_reservation(everything_open_reservation(p_assignment, null), 'failed', p_reason);
end;
$$;

-- Same as migration 168, and it refuses a switched-off notewriter.
create or replace function notewriter_subscribe(p_notewriter text, p_every_minutes int, p_takes_reader_requests boolean default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  w everything_notewriters;
begin
  update everything_notewriters
     set every_minutes = p_every_minutes,
         takes_reader_requests = coalesce(p_takes_reader_requests, takes_reader_requests),
         last_seen_at = now()
   where id = p_notewriter
  returning * into w;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  if w.disabled_at is not null then
    raise exception 'The notewriter % is switched off: %', w.id, coalesce(w.disabled_reason, 'no reason given') using errcode = 'PT403';
  end if;
  return jsonb_build_object('every_minutes', w.every_minutes, 'takes_reader_requests', w.takes_reader_requests);
end;
$$;

drop function notewriter_status(text);
create function notewriter_status(p_notewriter text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  w everything_notewriters;
begin
  select * into w from everything_notewriters where id = p_notewriter;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  return jsonb_build_object(
    'notewriter', to_jsonb(w) - 'silence_warned_for',
    'open', (select coalesce(jsonb_agg(jsonb_build_object(
                'assignment', r.id, 'started_at', r.started_at, 'deadline', r.deadline, 'reader_request', r.requested,
                'item', jsonb_build_object('id', i.id, 'url', i.url, 'title', i.title)) order by r.started_at), '[]')
               from everything_reservations r join everything_items i on i.id = r.item_id
              where r.notewriter_id = w.id and r.ended_at is null and r.deadline > now()),
    'last_failures', (select coalesce(jsonb_agg(jsonb_build_object('ended_at', f ->> 'at', 'outcome', f ->> 'outcome',
                                                                   'reason', f ->> 'reason', 'url', f ->> 'url')), '[]')
                        from jsonb_array_elements(everything_notewriter_last_failures(w.id)) f));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin functions, with the secret key or in the SQL editor
-- ---------------------------------------------------------------------------

-- Adds an outside notewriter and returns its key. The key is not stored, so
-- pass it on now.
create function notewriter_admin_create(p_id text, p_name text, p_owner text, p_contact text,
                                        p_notes_per_day int default 20, p_max_open int default 2) returns text
language plpgsql set search_path = public as $$
begin
  insert into everything_notewriters (id, name, owner, contact, outside, notes_per_day, max_open)
  values (p_id, p_name, p_owner, p_contact, true, p_notes_per_day, p_max_open);
  return everything_notewriter_new_key(p_id);
end;
$$;

-- Ends every key of a notewriter and returns a new one. Also how one of our
-- own notewriters gets its first key.
create function notewriter_admin_new_key(p_notewriter text) returns text
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from everything_notewriters where id = p_notewriter) then
    raise exception 'There is no notewriter %', p_notewriter;
  end if;
  update everything_notewriter_keys set revoked_at = now() where notewriter_id = p_notewriter and revoked_at is null;
  return everything_notewriter_new_key(p_notewriter);
end;
$$;

-- Switches a notewriter off or on again. Off refuses its key at once and ends
-- its open reservations as failed. The notes it posted stay up.
create function notewriter_admin_switch(p_notewriter text, p_on boolean, p_reason text default null) returns void
language plpgsql set search_path = public as $$
declare
  r everything_reservations;
begin
  update everything_notewriters
     set disabled_at = case when p_on then null else now() end,
         disabled_reason = case when p_on then null else p_reason end
   where id = p_notewriter;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  if not p_on then
    for r in select * from everything_reservations where notewriter_id = p_notewriter and ended_at is null for update loop
      perform everything_fail_reservation(r, 'failed', 'An admin switched the notewriter off: ' || coalesce(p_reason, 'no reason given'));
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. For cn-walk, and the feed run until its code is updated
-- ---------------------------------------------------------------------------

-- What changes with the clock alone, which no trigger sees. cn-walk calls it
-- every 5 minutes: open reservations past their deadline end as expired, and
-- listed posts that turned 14 days old leave the list. Their triggers update
-- the counts and list_open.
create function notewriter_tidy_list(out expired int, out closed int)
language plpgsql set search_path = public as $$
declare
  r everything_reservations;
begin
  expired := 0;
  for r in select * from everything_reservations where ended_at is null and deadline <= now() for update skip locked loop
    perform everything_fail_reservation(r, 'expired', 'The deadline passed without an answer');
    expired := expired + 1;
  end loop;
  update everything_items set list_date = list_date
   where list_open and not list_requested and list_date < current_date - everything_list_days();
  get diagnostics closed = row_count;
end;
$$;

-- Sets each creator's list_rank from the ranking cn-walk walks:
-- [{"feed_url": ..., "rank": ...}]. A project the ranking leaves out goes to
-- 0. Only changed rows are written.
create function notewriter_set_list_ranks(p_ranks jsonb) returns int
language plpgsql set search_path = public as $$
declare
  n int;
begin
  with wanted as (
    select p.id, coalesce(r.rank, 0) as rank
      from everything_projects p
      left join (select lower(x ->> 'feed_url') as feed_url, max((x ->> 'rank')::numeric) as rank
                   from jsonb_array_elements(p_ranks) x group by 1) r on r.feed_url = lower(p.feed_url)
  )
  update everything_projects p set list_rank = wanted.rank
    from wanted where wanted.id = p.id and p.list_rank is distinct from wanted.rank;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The feed run of migration 168 calls these two until its code is replaced.
create or replace function notewriter_take_back_overdue() returns int
language sql set search_path = public as $$ select expired from notewriter_tidy_list() $$;

create or replace function notewriter_feed_posts_wanted() returns table (wanted int, waiting int)
language sql stable set search_path = public as $$
  select (select count(*)::int from everything_notewriters where every_minutes is not null and disabled_at is null and not outside),
         (select count(*)::int from everything_items where list_open and not list_requested and list_team_count = 0)
$$;

-- ---------------------------------------------------------------------------
-- 9. Claude's drafts are posted as the notewriter that reserved the post
-- ---------------------------------------------------------------------------

-- Same signature as migration 177. An AI note is posted as the notewriter of
-- the post's open reservation, else of its last reservation, by one of our own
-- notewriters. It needs no reservation, because a draft is saved by our own
-- runner or posted by a reviewer on the review page.
create or replace function everything_claude_publish(p_draft uuid, p_posted_as text, p_actor text, p_author uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_item_url text;
  v_claim uuid;
  v_note uuid;
  v_posted jsonb;
  v_notewriter text;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if (p_posted_as = 'ai') <> (p_author is null) then
    raise exception 'An AI note has no author, and a person''s note needs one';
  end if;
  if p_posted_as = 'ai' then
    select r.notewriter_id into v_notewriter
      from everything_reservations r join everything_notewriters w on w.id = r.notewriter_id
     where r.item_id = d.item_id and not w.outside
     order by (r.ended_at is null) desc, r.started_at desc limit 1;
    v_posted := everything_post_note(coalesce(v_notewriter, 'claude-ai-box'), d.item_id, jsonb_build_object(
      'passage', d.passage, 'note', d.note, 'sources', d.sources,
      'context_url', d.video_timing ->> 'context_url',
      'start_seconds', d.video_timing -> 'start_seconds', 'end_seconds', d.video_timing -> 'end_seconds'));
    if v_posted ->> 'kind' <> 'posted' then raise exception 'Not posted: %', v_posted ->> 'reason'; end if;
    v_note := (v_posted ->> 'note')::uuid;
  else
    select url into v_item_url from everything_items where id = d.item_id;
    insert into everything_claims (item_id, claim, judgement, context_quote, context_url, start_seconds, end_seconds, status, created_by)
    values (
      d.item_id, left(d.passage, 300), 'claude_code', d.passage,
      coalesce(d.video_timing ->> 'context_url', v_item_url),
      (d.video_timing ->> 'start_seconds')::int, (d.video_timing ->> 'end_seconds')::int,
      'note', p_author
    )
    returning id into v_claim;
    -- The trigger everything_fill_author_name replaces this placeholder with
    -- the account's own name.
    insert into everything_notes (claim_id, note, author_id, author_name)
    values (v_claim, d.note, p_author, 'author')
    returning id into v_note;
    insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
    select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
      from jsonb_array_elements(d.sources) with ordinality as t(s, n);
  end if;
  update everything_claude_drafts
     set status = 'posted', note_id = v_note, posted_as = p_posted_as, updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (p_actor, 'posted', d.id, d.item_id, v_note, jsonb_build_object('posted_as', p_posted_as, 'note', d.note));
  return v_note;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. What nothing calls any more
-- ---------------------------------------------------------------------------

drop function everything_notewriter_assign(everything_notewriters, everything_items);
drop function everything_notewriter_record_failure(uuid, text, text);
drop function everything_item_has_notewriter_left(everything_items);
drop function everything_notewriter_failed_on(text, everything_items);
drop function everything_notewriter_cooldown(int);
drop function everything_is_reader_request(everything_items);

-- ---------------------------------------------------------------------------
-- 11. Who may call what
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'everything_priority_rank()',
    'everything_list_days()',
    'everything_reservation_counts(everything_reservations)',
    'everything_item_reservation_counts(uuid, timestamptz)',
    'everything_notewriter_from_key()',
    'everything_notewriter_new_key(text)',
    'everything_asked_passages(uuid)',
    'everything_post_for_notewriter(everything_items)',
    'everything_list_key(everything_items, boolean)',
    'everything_list_page(text, int, jsonb, int, boolean, text, text)',
    'everything_reserve(everything_notewriters, uuid, int)',
    'everything_open_reservation(uuid, text)',
    'everything_finish_reservation(everything_reservations, jsonb, text)',
    'everything_fail_reservation(everything_reservations, text, text)',
    'everything_post_note(text, uuid, jsonb)',
    'everything_notewriter_last_failures(text)',
    'everything_v1_post(jsonb)',
    'everything_v1_take(everything_notewriters, text)',
    'notewriter_next_post(text)',
    'notewriter_add_note(text, uuid, jsonb)',
    'notewriter_finish(uuid, jsonb, text)',
    'notewriter_fail(uuid, text)',
    'notewriter_subscribe(text, int, boolean)',
    'notewriter_status(text)',
    'notewriter_admin_create(text, text, text, text, int, int)',
    'notewriter_admin_new_key(text)',
    'notewriter_admin_switch(text, boolean, text)',
    'notewriter_tidy_list()',
    'notewriter_set_list_ranks(jsonb)',
    'notewriter_take_back_overdue()',
    'notewriter_feed_posts_wanted()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'notewriter_api_me()',
    'notewriter_api_posts(int, jsonb, int, text, boolean, text)',
    'notewriter_api_post(uuid, text)',
    'notewriter_api_reserve(uuid, int)',
    'notewriter_api_finish(uuid, jsonb, text)',
    'notewriter_api_fail(uuid, text)',
    'notewriter_api_add_note(uuid, jsonb)',
    'notewriter_api_notes(int, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$$;

revoke all on function everything_notewriters_overview() from public, anon;
grant execute on function everything_notewriters_overview() to authenticated, service_role;
grant select on everything_notewriter_health to service_role;
grant select, insert, update on everything_reservations to service_role;
grant select on everything_notewriter_keys to service_role;

notify pgrst, 'reload schema';

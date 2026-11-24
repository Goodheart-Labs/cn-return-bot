-- The post list ranks a post by its creator's rank plus the different readers
-- who opened it in the last 24 hours (GOO-868).
--
-- Until now a post's place in the list came from its creator alone, plus one
-- exception: a page cn-walk added because 3 (text) or 5 (video) readers opened
-- it (migration 183) ranked like a post of a creator holding priority. Creator
-- ranks barely tell the listed posts apart: on the 1-day list of 2026-11-19 to
-- 11-23, 80% of posts had a rank between 0.87 and 1.17, and 84% had no reader
-- yet. So a single reader now lifts a post above almost every post nobody
-- opened, and posts of creators holding priority (1000 and up) and requested
-- posts still come first.
--
-- Replayed on the checks of 2026-11-19 08:00 to 11-23 00:00, the checked posts
-- drew 113 later readers a day instead of 103 on the 1-day list, and 107
-- instead of 90 on the old 14-day list (readers in the 24 hours after each
-- check; src/scripts_jim/2026_11_24_reader_count_ranking/). Counting every
-- reader so far did as well on the 1-day list but worse on the 14-day one,
-- because it lifts old posts whose readers have come and gone. The weight of a
-- reader hardly mattered between 0.25 and 100, so it is 1.
--
-- The count lives in everything_items.list_readers. notewriter_tidy_list
-- (cn-walk, every 5 minutes) refreshes it for every listed post, and the list
-- trigger adds it to the creator's rank. Migration 183's pages keep entering
-- the list, but without their priority rank: their readers lift them now.
--
-- ORDER: any. No code reads the new column, except the listing's new field
-- readers. UNDO: put back everything_items_list_fields and
-- notewriter_tidy_list from migrations 186 and 184 and notewriter_api_posts
-- from 184, then `update everything_items set list_rank = list_rank where
-- list_open` and drop the column.

alter table everything_items add column list_readers int not null default 0;
comment on column everything_items.list_readers is
  'Copy for the post list: the different reader hashes that opened the page in the last 24 hours, refreshed by notewriter_tidy_list every 5 minutes. list_rank adds it to the creator''s rank (GOO-868).';
comment on column everything_items.list_rank is
  'Copy for the post list: the creator''s list_rank plus list_readers.';
comment on column everything_items.demanded_at is
  'When cn-walk added the page because several readers opened it (GOO-793). Its days in the list start then. It ranks like any post, by its creator''s rank plus its readers (GOO-868).';

-- Same as migration 186, with the readers added and without the priority rank
-- of a page readers opened.
create or replace function everything_items_list_fields() returns trigger
language plpgsql set search_path = public as $$
declare
  v_counts record;
begin
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done'
     and new.requested_since is not distinct from old.requested_since then
    new.requested_since := null;
  end if;
  new.list_requested := new.requested_since is not null;
  new.list_date := coalesce(new.demanded_at::date, new.published_at, new.created_at::date);
  new.list_rank := coalesce((select p.list_rank from everything_projects p where p.id = new.project_id), 0) + new.list_readers;
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

-- The different readers of each page in the last 24 hours. A LessWrong post's
-- /comments page counts for the post, as in migration 183.
create function everything_recent_page_readers() returns table (page_url text, readers int)
language sql stable set search_path = public as $$
  select regexp_replace(v.page_url, '/comments$', ''), count(distinct v.reader_hash)::int
    from everything_link_visits v
   where v.visited_at > now() - interval '24 hours' and v.reader_hash is not null
   group by 1
$$;
revoke all on function everything_recent_page_readers() from public, anon, authenticated;
grant execute on function everything_recent_page_readers() to service_role;

-- Same as migration 184, plus the readers of every listed post. Only rows
-- whose count changed are written. A post that left the list goes back to 0,
-- so it comes back without an old count when a reader asks about it.
create or replace function notewriter_tidy_list(out expired int, out closed int)
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
  update everything_items i set list_readers = w.readers
    from (select i2.id, case when i2.list_open then coalesce(pr.readers, 0) else 0 end as readers
            from everything_items i2
            left join everything_recent_page_readers() pr on pr.page_url = everything_visit_page(i2.url)
           where i2.list_open or i2.list_readers > 0) w
   where w.id = i.id and i.list_readers <> w.readers;
end;
$$;

-- Same as migration 184, except that a post's creator score and priority no
-- longer include its readers, which the listing shows on their own.
create or replace function notewriter_api_posts(p_limit int default 1, p_after jsonb default null, p_max_others int default 0,
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
      'creator_priority', i.list_rank - i.list_readers >= everything_priority_rank(),
      'creator_score', round(mod(i.list_rank - i.list_readers, everything_priority_rank()), 2),
      'readers', i.list_readers,
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

-- Migration 183's pages lose their priority rank, and every listed post gets
-- its readers.
update everything_items set list_rank = list_rank where list_open and demanded_at is not null;
select notewriter_tidy_list();

notify pgrst, 'reload schema';

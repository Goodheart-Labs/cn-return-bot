-- A reader of the last 24 hours adds 0.7 to a listed post's rank instead of
-- 1 (GOO-871, Jim's choice on 2026-11-24). Creator ranks of walked creators
-- mostly lie between 1.0 and 1.2, so one reader still lifts a post above almost
-- every post nobody opened. A creator ranked well above the rest keeps a post
-- that one reader opened behind theirs.
--
-- The weight is everything_reader_weight(), which the list trigger and the
-- listing's creator score both read, like everything_priority_rank().
--
-- ORDER: any. UNDO: make everything_reader_weight() return 1 and run
-- `update everything_items set list_rank = list_rank where list_open`.

create function everything_reader_weight() returns numeric
language sql immutable set search_path = public as $$ select 0.7 $$;
comment on function everything_reader_weight() is
  'What each different reader of the last 24 hours (everything_items.list_readers) adds to a listed post''s list_rank (GOO-871).';

comment on column everything_items.list_rank is
  'Copy for the post list: the creator''s list_rank plus everything_reader_weight() times list_readers.';

-- Same as migration 201, with the readers weighed.
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
  new.list_rank := coalesce((select p.list_rank from everything_projects p where p.id = new.project_id), 0)
                   + everything_reader_weight() * new.list_readers;
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

-- Same as migration 201, with the readers weighed.
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
      'creator_priority', i.list_rank - everything_reader_weight() * i.list_readers >= everything_priority_rank(),
      'creator_score', round(mod(i.list_rank - everything_reader_weight() * i.list_readers, everything_priority_rank()), 2),
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

update everything_items set list_rank = list_rank where list_open or list_readers > 0;

notify pgrst, 'reload schema';

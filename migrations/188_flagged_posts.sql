-- 188: posts the image screen flagged (GOO-815).
--
-- Before a Claude starts on a post, the runner screens every image the post
-- links to (src/claude-notes/imageScreen.ts). A post with a flagged image must
-- never reach any Claude, ours or anyone else's, because a Claude account was
-- banned once over images of child sexual abuse. So the flag is kept on the
-- post itself, and the database enforces it:
--
-- * The post leaves the post list (list_open is false), so no notewriter is
--   listed it again.
-- * Reserving it is refused, so a notewriter that knows its id cannot take it.
-- * Every open reader request on it ends as an error, and so does every
--   request that comes in later. The extension shows a failed request. The
--   versions in the stores say "failed, will retry"; a newer version says
--   "failed, this page can't be checked" for the skip reason 'image flagged'.
-- * The post is done, with the skip reason 'image flagged', so the walk's
--   retries and the demand queue leave it alone.
--
-- Nothing unflags a post. An admin who decides a flag was wrong clears
-- flagged_at by hand.
--
-- UNDO: drop the triggers everything_items_list_flagged and
--       everything_note_requests_flagged with their functions, drop
--       everything_flag_item, re-run everything_reserve of migration 184, then
--       alter table everything_items drop column flagged_at, drop column flagged_reason;

alter table everything_items
  add column flagged_at timestamptz,
  add column flagged_reason text;
comment on column everything_items.flagged_at is
  'When the image screen flagged an image of this post. A flagged post is never listed or reserved, and requests on it fail.';
comment on column everything_items.flagged_reason is
  'What the image screen saw, for example the score. Never the image''s address.';

-- A flagged post is never listed and never requested. This is a trigger of its
-- own rather than a change to the list trigger (everything_items_list_fields),
-- because migration 186 rewrites that trigger and may be applied after this
-- one. Triggers of the same kind fire in the order of their names, so this one
-- runs after the list trigger and has the last word.
create function everything_items_list_flagged() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.flagged_at is not null then
    new.requested_since := null;
    new.list_requested := false;
    new.list_open := false;
  end if;
  return new;
end;
$$;
create trigger everything_items_list_flagged before insert or update on everything_items
  for each row execute function everything_items_list_flagged();

-- everything_reserve of migration 184, plus: a flagged post is refused.
create or replace function everything_reserve(w everything_notewriters, p_item uuid, p_at_most int) returns jsonb
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
  if i.flagged_at is not null then
    raise exception 'Post % was flagged by the image screen and cannot be checked', p_item using errcode = 'PT403';
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

-- What a request on a flagged post says. The reader sees only that it failed.
create function everything_flagged_request_reason() returns text
language sql immutable set search_path = public as $$
  select 'an image on the page was flagged by the moderation check'::text
$$;

-- A request that reaches a flagged post, now or later, fails at once instead
-- of waiting for a check that never comes.
create function everything_note_requests_flagged() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.item_id is not null and new.status in ('pending', 'enqueued')
     and exists (select 1 from everything_items where id = new.item_id and flagged_at is not null) then
    new.status := 'error';
    new.status_reason := everything_flagged_request_reason();
  end if;
  return new;
end;
$$;
create trigger everything_note_requests_flagged before insert or update on everything_note_requests
  for each row execute function everything_note_requests_flagged();

-- Flags a post: the runner calls this when the image screen stops a post,
-- before it ends its reservation. Returns how many reader requests failed.
create function everything_flag_item(p_item uuid, p_reason text) returns int
language plpgsql set search_path = public as $$
declare
  v_failed int;
begin
  update everything_items
     set flagged_at = now(), flagged_reason = left(p_reason, 500), status = 'done', skip_reason = 'image flagged',
         progress = null, processed_at = now()
   where id = p_item;
  if not found then raise exception 'There is no post %', p_item using errcode = 'PT404'; end if;
  update everything_note_requests
     set status = 'error', status_reason = everything_flagged_request_reason()
   where item_id = p_item and status in ('pending', 'enqueued');
  get diagnostics v_failed = row_count;
  return v_failed;
end;
$$;
revoke all on function everything_flag_item(uuid, text) from public, anon, authenticated;
grant execute on function everything_flag_item(uuid, text) to service_role;

notify pgrst, 'reload schema';

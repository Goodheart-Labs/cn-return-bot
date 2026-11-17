-- 142: the Claude note writer takes as many posts as Nathan's weekly usage
-- allows (GOO-587).
--
-- 1. The feed run may set its alarm for the Claude note writer's next post,
--    with the new reason 'usage'.
-- 2. everything_claude_settings.posts_in_flight is dropped. The feed run now
--    spaces Claude's posts by the weekly usage, and gives Claude a new post
--    only while fewer than 3 feed posts are in the queue.

-- ---------------------------------------------------------------------------
-- 1. The alarm's new reason.

alter table everything_feed_schedule drop constraint everything_feed_schedule_next_run_reason_check;
alter table everything_feed_schedule add constraint everything_feed_schedule_next_run_reason_check
  check (next_run_reason in ('interval', 'midnight', 'idle', 'usage'));
comment on column everything_feed_schedule.next_run_reason is
  'interval: one pacing interval after the last post started. midnight: the money left does not cover one average post. idle: the run found nothing to process. usage: the Claude note writer''s next post is due, spaced so that Nathan''s weekly usage reaches its target by the reset.';

-- ---------------------------------------------------------------------------
-- 2. The settings without posts_in_flight.

drop function everything_claude_change_settings(text, boolean, text, int);
alter table everything_claude_settings drop column posts_in_flight;

create function everything_claude_change_settings(
  p_writer text default null,
  p_approval_required boolean default null,
  p_actor text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  update everything_claude_settings
     set writer = coalesce(p_writer, writer),
         approval_required = coalesce(p_approval_required, approval_required),
         updated_at = now(),
         updated_by = v_actor
   where id;
  insert into everything_claude_events (actor, type, data)
  values (v_actor, 'settings_changed', jsonb_strip_nulls(jsonb_build_object('writer', p_writer, 'approvalRequired', p_approval_required)));
end;
$$;

revoke execute on function everything_claude_change_settings(text, boolean, text) from public, anon, authenticated;
grant execute on function everything_claude_change_settings(text, boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';

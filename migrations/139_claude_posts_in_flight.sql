-- 139: how many feed posts the Claude note writer gets at once (GOO-580).
-- A post Claude works on stays queued until it is finished, and the feed run
-- walks for a new post only while fewer feed posts than this are queued. So
-- this number is how many feed posts Claude may hold at the same time. 1 is
-- the rate before this migration. Reader requests are not counted: they enter
-- the queue whenever readers send them.

alter table everything_claude_settings
  add column posts_in_flight int not null default 1 check (posts_in_flight between 1 and 10);
comment on column everything_claude_settings.posts_in_flight is
  'While writer = claude, the feed run keeps up to this many feed posts queued for Claude.';

drop function everything_claude_change_settings(text, boolean, text);

create function everything_claude_change_settings(
  p_writer text default null,
  p_approval_required boolean default null,
  p_actor text default null,
  p_posts_in_flight int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  update everything_claude_settings
     set writer = coalesce(p_writer, writer),
         approval_required = coalesce(p_approval_required, approval_required),
         posts_in_flight = coalesce(p_posts_in_flight, posts_in_flight),
         updated_at = now(),
         updated_by = v_actor
   where id;
  insert into everything_claude_events (actor, type, data)
  values (v_actor, 'settings_changed', jsonb_strip_nulls(jsonb_build_object(
    'writer', p_writer, 'approvalRequired', p_approval_required, 'postsInFlight', p_posts_in_flight)));
end;
$$;

revoke execute on function everything_claude_change_settings(text, boolean, text, int) from public, anon, authenticated;
grant execute on function everything_claude_change_settings(text, boolean, text, int) to authenticated, service_role;

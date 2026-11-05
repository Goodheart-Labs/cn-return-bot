-- The second half of the notewriter protocol (GOO-724). Apply it once the code
-- of migration 168 runs on the ai-box, the devbox, the services box and in the
-- feed run. Until then the old code still reads what this drops.
--
-- 1. The writer switch is gone. Who writes is decided by the subscriptions in
--    everything_notewriters, so the review page no longer says who writes.
-- 2. The feed run reports failures from everything_assignments and silences
--    per notewriter, so the two Claude-only columns of the schedule go.

drop function everything_claude_change_settings(text, text);

drop function everything_review_summary(jsonb);
create function everything_review_summary(p_request jsonb)
returns table (reviewer text, matching bigint, newest timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
  v_matching bigint;
  v_newest timestamptz;
begin
  execute format('select count(*), max(f.written) from everything_review_field_rows($1, $2) f where %s',
                 field_query_condition('everything_review_field_row', p_request -> 'filters'))
    into v_matching, v_newest
    using v_reviewer, everything_item_views();
  return query select v_reviewer, v_matching, v_newest;
end;
$$;
revoke all on function everything_review_summary(jsonb) from public, anon;
grant execute on function everything_review_summary(jsonb) to authenticated, service_role;

drop table everything_claude_settings;

alter table everything_feed_schedule drop column claude_failures_reported_through;
alter table everything_feed_schedule drop column claude_silence_warned_for;

notify pgrst, 'reload schema';

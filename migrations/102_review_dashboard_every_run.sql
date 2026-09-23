-- 102: a review-dashboard page of every pipeline run, posted or not.
--
-- The dashboard's normal list comes from review_dashboard_base_m, which holds
-- posted notes, missed opportunities and three kinds of rejected run. Most runs
-- never appear there: a tweet the prefilter passed over, a writer that found
-- nothing to correct, a run that died of an error. Those are the runs you need
-- when asking "why did we not note this tweet?".
--
-- This function pages straight through pipeline_runs, newest first, and returns
-- the same item shape review_dashboard_page returns, so the client renders the
-- rows with the cards it already has. It is a separate function on purpose. The
-- materialized view is the largest recurring read on a small instance (see
-- migrations 075 and 080), and adding ~140k runs to it would make every hourly
-- refresh pay for rows that are looked at rarely. Here the cost is one index
-- range scan on idx_pipeline_runs_created_at, paid only when someone looks.
--
-- Annotation ids line up with the normal list, so a tag or a seen mark made in
-- either list shows in both: a submitted run uses its note id, the three
-- rejection reasons the normal list already shows keep their 'loweval:' id, and
-- every other run is 'run:<id>'.
--
-- Only the `seen` and `ab` filter keys apply. There is no total count: counting
-- every run on each first page is a scan the list does not need.

create or replace function review_dashboard_runs_page(
  p_filters     jsonb       default '{}'::jsonb,
  p_cursor_date timestamptz default null,
  p_cursor_id   text        default null,
  p_page_size   int         default 50
) returns json
language sql stable security definer set search_path = public as $$
  with f as (
    select
      case when p_filters ? 'seen' then (p_filters->>'seen')::boolean end as seen_filter,
      case when p_filters ? 'ab' then p_filters->'ab' end                 as ab
  ),
  runs as (
    -- The columns are named, not r.*, so the page never carries a run's logs or
    -- search results, which are large and which no card shows.
    select
      r.id, r.tweet_id, r.created_at, r.outcome, r.outcome_reason, r.note_id,
      r.note_text, r.bot_name, r.ab_test_picks,
      case
        when r.outcome = 'submitted' and r.note_id is not null then r.note_id::text
        when r.outcome_reason in ('low_evaluation_score', 'daily_limit_reached', 'check_failed')
          then 'loweval:' || r.id::text
        else 'run:' || r.id::text
      end as item_id
    from pipeline_runs r
    -- The first condition is the one the created_at index can use. The row
    -- comparison then breaks ties between runs created in the same instant.
    where p_cursor_id is null
       or (r.created_at <= p_cursor_date
           and (r.created_at, r.id::text) < (p_cursor_date, p_cursor_id))
  ),
  page as (
    select
      r.*,
      a.id as ann_id, a.seen, a.failure_modes, a.comment, a.high_value
    from runs r
    cross join f
    left join review_dashboard_annotations a
      on a.source = 'production' and a.target_id = r.item_id
    where (f.seen_filter is null or coalesce(a.seen, false) = f.seen_filter)
      and (f.ab is null or coalesce(r.ab_test_picks, '{}'::jsonb) @> f.ab)
    order by r.created_at desc, r.id::text desc
    limit least(greatest(p_page_size, 1), 200)
  )
  select json_build_object(
    'items', coalesce((select json_agg(json_build_object(
        'id', p.item_id,
        'source', 'production',
        'tweetId', p.tweet_id,
        'tweetText', t.text,
        'tweetHandle', t.author_handle,
        'hasPhoto', coalesce(t.has_photo, false),
        'hasVideo', coalesce(t.has_video, false),
        'mediaCount', coalesce(t.media_count, 0),
        'tweetMedia', t.media,
        'referencedTweetData', t.referenced_tweet_data,
        'noteId', case when p.outcome = 'submitted' then p.note_id::text end,
        'noteText', p.note_text,
        'createdAt', p.created_at,
        'outcome', p.outcome,
        'outcomeReason', p.outcome_reason,
        'pipelineRunId', p.id,
        'botId', p.bot_name,
        'abTestPicks', p.ab_test_picks,
        'comparisonNotes', '[]'::json,
        'annotation', case when p.ann_id is not null then json_build_object(
          'id', p.ann_id,
          'seen', coalesce(p.seen, false),
          'failureModes', coalesce(p.failure_modes, '{}'::text[]),
          'comment', p.comment,
          'highValue', coalesce(p.high_value, false)
        ) end,
        'evaluationScore', (select ps.score_value from pipeline_scores ps
                            where ps.pipeline_run_id = p.id and ps.score_type = 'evaluation'
                            limit 1),
        'isDraft', p.outcome is distinct from 'submitted',
        'failureType', case p.outcome_reason
          when 'low_evaluation_score' then 'filtered_low_eval_score'
          when 'daily_limit_reached'  then 'filtered_no_slot'
          when 'check_failed'         then 'draft_check_failed'
          else 'pipeline_run'
        end,
        'sortDate', p.created_at
      ) order by p.created_at desc, p.id::text desc)
      from page p
      left join tweets t on t.tweet_id = p.tweet_id), '[]'::json),
    'nextCursor', case
      when (select count(*) from page) = least(greatest(p_page_size, 1), 200) then
        (select json_build_object('d', created_at, 'id', id::text)
         from page order by created_at asc, id::text asc limit 1)
    end,
    'totalItems', null
  );
$$;

revoke all on function review_dashboard_runs_page(jsonb, timestamptz, text, int) from public, anon, authenticated;
grant execute on function review_dashboard_runs_page(jsonb, timestamptz, text, int) to service_role;
alter function review_dashboard_runs_page(jsonb, timestamptz, text, int) set jit = off;

notify pgrst, 'reload schema';

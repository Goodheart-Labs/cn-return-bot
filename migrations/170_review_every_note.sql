-- 170: the review page lists every note, not only Claude's (GOO-735).
--
-- Until now each card on the review page was one draft of the Claude note
-- writer (everything_claude_drafts). Notes by the pipeline and by people never
-- showed, so Nathan could not find them to post on X, and the "Posted on X"
-- filter showed 7 of the 22 notes marked as posted. Now the page has one entry
-- per Claude draft plus one per note that has no draft. An entry's id is the
-- draft's id for a Claude draft and the note's id for any other note. Both are
-- random uuids, so they never collide.
--
-- A new field, `source`, says who wrote the entry: 'claude' for a Claude
-- draft, 'human' for a note with an author, and 'pipeline' for any other note.
-- A Claude note that an admin posted under their own account counts as
-- Claude's, because it has a draft.
--
-- A note without a draft has no chat, no review note, no judge's guess and no
-- few-shot mark, because all of those belong to a draft. Its approval follows
-- Jim's and Nathan's votes by the rule of migration 151, the same rule the
-- trigger writes into a draft's verdict.
--
-- The page's other functions (everything_review_page, _summary, _facets and
-- _drafts) only call the two functions below, so they now see every note
-- without a change of their own.

-- One entry of the review page per Claude draft and per other note that is
-- not hidden, with the columns a draft has. A note fills them from its claim.
-- With `p_ids`, only the entries with those ids.
create function everything_review_entries(p_ids uuid[] default null)
returns table (
  id uuid,
  draft_id uuid,
  note_id uuid,
  item_id uuid,
  source text,
  passage text,
  claim text,
  context_paragraph text,
  kind text,
  outcome text,
  note text,
  reasoning text,
  sources jsonb,
  status text,
  verdict text,
  reviewed_by text,
  reviewed_at timestamptz,
  posted_as text,
  created_at timestamptz,
  proposed_note text,
  proposed_sources jsonb,
  review_note text,
  review_note_by text,
  review_note_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with reviewers as (
    select u.id, a.reviewer
      from auth.users u
      join everything_admins a on a.email = lower(u.email)
     where a.reviewer is not null
  ),
  notes as materialized (
    select n.*
      from everything_notes n
     where n.claim_id is not null
       and n.status <> 'hidden'
       and (p_ids is null or n.id = any (p_ids))
       and not exists (select 1 from everything_claude_drafts d where d.note_id = n.id)
  ),
  reviews as (
    select v.note_id,
           bool_or(v.vote > 0) as any_helpful,
           bool_or(v.vote < 0) as any_not_helpful,
           (array_agg(r.reviewer order by v.updated_at desc))[1] as last_reviewer,
           max(v.updated_at) as last_at
      from everything_votes v
      join reviewers r on r.id = v.voter_id
     where v.vote <> 0 and v.note_id in (select id from notes)
     group by v.note_id
  ),
  verdicts as (
    select r.*,
           case
             when r.any_helpful and r.any_not_helpful then null
             when r.any_helpful then 'approved'
             when r.any_not_helpful then 'disapproved'
           end as verdict
      from reviews r
  ),
  source_lists as (
    select s.note_id,
           jsonb_agg(jsonb_build_object('url', s.url, 'quote', coalesce(s.quote, ''), 'explanation', coalesce(s.explanation, '')) order by s.sort_order) as sources
      from everything_note_sources s
     where s.note_id in (select id from notes)
     group by s.note_id
  )
  select d.id, d.id, d.note_id, d.item_id, 'claude',
         d.passage, d.claim, d.context_paragraph, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.verdict, d.reviewed_by, d.reviewed_at, d.posted_as, d.created_at,
         d.proposed_note, d.proposed_sources, d.review_note, d.review_note_by, d.review_note_at
    from everything_claude_drafts d
   where p_ids is null or d.id = any (p_ids)
  union all
  select n.id, null, n.id, c.item_id,
         case when n.author_id is null then 'pipeline' else 'human' end,
         coalesce(c.context_quote, ''), c.claim, c.context_paragraph, null, 'note', n.note, null,
         coalesce(sl.sources, '[]'::jsonb),
         'posted', v.verdict,
         case when v.verdict is not null then v.last_reviewer end,
         case when v.verdict is not null then v.last_at end,
         case when n.author_id is null then 'ai' else (select r.reviewer from reviewers r where r.id = n.author_id) end,
         n.created_at,
         null, null, null, null, null
    from notes n
    join everything_claims c on c.id = n.claim_id
    left join verdicts v on v.note_id = n.id
    left join source_lists sl on sl.note_id = n.id;
$$;

alter type everything_review_field_row
  -- 'claude', 'pipeline' or 'human'.
  add attribute source text;

-- As in migration 155, over every entry instead of only the drafts, and with
-- the entry's source. Everything that belongs to a draft joins on draft_id,
-- which a note without a draft does not have.
create or replace function everything_review_field_rows(p_reviewer text, p_views everything_item_views, p_ids uuid[] default null)
returns setof everything_review_field_row
language sql stable security definer set search_path = public as $$
  with entries as materialized (
    select * from everything_review_entries(p_ids)
  ),
  reviewers as (
    select u.id, a.reviewer
      from auth.users u
      join everything_admins a on a.email = lower(u.email)
     where a.reviewer is not null
  ),
  vote_names (vote, name) as (values (1, 'helpful'), (0, 'somewhat'), (-1, 'not_helpful')),
  votes as (
    select v.note_id,
           min(vn.name) filter (where v.voter_id = auth.uid()) as mine,
           min(vn.name) filter (where r.reviewer = 'jim') as jim,
           min(vn.name) filter (where r.reviewer = 'nathan') as nathan
      from everything_votes v
      join vote_names vn using (vote)
      left join reviewers r on r.id = v.voter_id
     where v.note_id in (select note_id from entries)
     group by v.note_id
  ),
  item_views as (
    select unnest(p_views.item_ids) as item_id, unnest(p_views.viewers) as viewers
  ),
  creators as (
    select i.project_id, avg(v.viewers)::float8 as views, count(*)::int as posts
      from item_views v
      join everything_items i on i.id = v.item_id
     where v.viewers >= 1
     group by i.project_id
  ),
  last_chat as (
    select distinct on (e.draft_id) e.draft_id, e.actor
      from everything_claude_events e
     where e.type in ('message', 'answer') and e.draft_id in (select draft_id from entries)
     order by e.draft_id, e.id desc
  )
  select d.id,
         coalesce(x.mark, 'not_posted'),
         coalesce(vt.mine, 'none'),
         coalesce(vt.jim, 'none'),
         coalesce(vt.nathan, 'none'),
         case
           when n.id is null then 'other'
           when n.state = 'helpful' then 'helpful'
           when n.state = 'not_helpful' then 'not_helpful'
           when n.not_helpful_count = 0 and n.upvotes > 0 then 'upvoted'
           when n.not_helpful_count > 0 and n.upvotes = 0 then 'downvoted'
           else 'other'
         end,
         j.p_helpful,
         j.p_impactful,
         coalesce(n.helpful_count, 0),
         coalesce(n.somewhat_helpful_count, 0),
         coalesce(n.not_helpful_count, 0),
         coalesce(n.feed_votes, 0),
         coalesce(iv.viewers, 0),
         p.slug,
         p.name,
         coalesce(c.views, 0),
         coalesce(c.posts, 0),
         d.created_at,
         coalesce(i.published_time, i.published_at::timestamptz),
         case
           when d.status = 'not_a_note' then null
           when d.verdict is not null then d.verdict
           when n.state = 'helpful' then 'approved'
           when n.state = 'not_helpful' then 'disapproved'
           else 'not_reviewed'
         end,
         d.outcome,
         case when d.status <> 'not_a_note' then d.kind end,
         case d.status when 'posted' then 'on_site' when 'posting' then 'not_yet' when 'removed' then 'deleted' end,
         d.posted_as,
         s.draft_id is not null,
         b.note_id is not null,
         f.draft_id is not null,
         case when lc.draft_id is null then 'none' when lc.actor = 'claude' then 'answered' else 'waiting' end,
         coalesce(d.review_note, '') <> '',
         char_length(d.note),
         (select count(distinct src ->> 'url')::int from jsonb_array_elements(d.sources) src),
         coalesce(p.x_handle_status, 'unknown'),
         p.x_handle,
         p.x_handle_evidence,
         case x.mark when 'scheduled' then x.scheduled_for when 'posted' then x.published_at end,
         x.tweet_url,
         d.source
    from entries d
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join creators c on c.project_id = i.project_id
    left join item_views iv on iv.item_id = d.item_id
    left join lateral (
      select n.*, everything_note_status(n.p_helpful) as state,
             n.helpful_count - (n.author_id is not null)::int + n.somewhat_helpful_count as upvotes
        from everything_notes n
       where n.id = d.note_id
    ) n on true
    left join votes vt on vt.note_id = d.note_id
    left join everything_note_x_marks x on x.note_id = d.note_id
    left join everything_claude_judgements j on j.draft_id = d.draft_id and j.note = d.note
    left join everything_claude_skips s on s.draft_id = d.draft_id and s.reviewer = p_reviewer
    left join everything_best_notes b on b.note_id = d.note_id
    left join everything_claude_few_shot_examples f on f.draft_id = d.draft_id
    left join last_chat lc on lc.draft_id = d.draft_id;
$$;

-- As in migration 153, over every entry. A note without a draft has no
-- messages and no earlier versions, because those are events of a draft.
create or replace function everything_review_rows(p_ids uuid[], p_reviewer text, p_views everything_item_views) returns setof everything_review_draft
language sql stable security definer set search_path = public as $$
  select d.id, d.item_id, d.passage, d.claim, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.verdict, d.note_id, d.posted_as, d.reviewed_by, d.reviewed_at, d.created_at, d.context_paragraph,
         i.url, i.title, p.name, p.slug,
         d.proposed_note, d.proposed_sources,
         j.reasoning,
         coalesce((
           select jsonb_agg(jsonb_build_object('reviewer', everything_reviewer_of(v.voter_id), 'vote', v.vote) order by v.updated_at)
             from everything_votes v
            where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null
         ), '[]'::jsonb),
         d.review_note, d.review_note_by, d.review_note_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', '')) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.draft_id and e.type in ('message', 'answer')
         ), '[]'::jsonb),
         -- Rewrites imported from the GOO-504 file log name the old text
         -- previousNote.
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', e.at,
                    'note', coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote', e.data ->> 'note', ''),
                    'reason', coalesce(e.data ->> 'reason', e.data ->> 'reply', '')
                  ) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.draft_id
              and ((e.type = 'rewritten' and coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote') is not null) or e.type = 'withdrawn')
         ), '[]'::jsonb),
         to_jsonb(f) - 'id',
         null::float8[]
    from everything_review_entries(p_ids) d
    join everything_review_field_rows(p_reviewer, p_views, p_ids) f on f.id = d.id
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join everything_claude_judgements j on j.draft_id = d.draft_id and j.note = d.note
   order by array_position(p_ids, d.id);
$$;

revoke all on function everything_review_entries(uuid[]) from public, anon, authenticated;
grant execute on function everything_review_entries(uuid[]) to service_role;

notify pgrst, 'reload schema';

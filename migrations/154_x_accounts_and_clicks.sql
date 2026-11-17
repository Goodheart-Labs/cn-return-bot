-- 154: each creator's X account, and counting the clicks that lead to the
-- extension (GOO-639, GOO-640).
--
-- 1. Every project gets the X account of its creator, or the fact that it has
--    none, with a sentence of evidence and who found it. The Claude note
--    writer's runner looks up every creator that has a Claude note and no
--    answer yet (src/claude-notes/runner.ts). The 19 handles Nathan checked
--    through the X API on 2026-09-23 for his posting tool (PR #528) are
--    filled in now. The review page's field row gets the account, so a tweet
--    names the creator and the Filter menu can narrow by it.
-- 2. The event whitelist gets extension_store_clicked back and the new
--    get_extension_clicked. Migration 103 added extension_store_clicked, but
--    it was never applied on production, so every click on a store button
--    since then was refused and lost.
-- 3. everything_click_counts counts, since a moment, how often a link to one
--    note was opened, each "Get the extension" button was clicked, and each
--    store was clicked through to, for the admin dashboard.

-- 1. X accounts.

alter table everything_projects
  add column x_handle text check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  add column x_handle_status text check (x_handle_status in ('found', 'none')),
  add column x_handle_evidence text check (length(x_handle_evidence) <= 1000),
  add column x_handle_checked_by text check (x_handle_checked_by in ('jim', 'nathan', 'claude')),
  add column x_handle_checked_at timestamptz,
  add constraint everything_projects_x_handle_found check ((x_handle is not null) = (x_handle_status is not distinct from 'found'));
comment on column everything_projects.x_handle_status is
  'found: the creator posts on X as x_handle. none: they have no X account we could find. Null: nobody looked yet.';

update everything_projects p
   set x_handle = h.handle, x_handle_status = 'found', x_handle_checked_by = 'nathan', x_handle_checked_at = '2026-09-23',
       x_handle_evidence = 'Checked by Nathan through the X API for his posting tool.'
  from (values
  ('ai-2040', 'AI_Futures_'),
  ('andymasley', 'AndyMasley'),
  ('astralcodexten', 'slatestarcodex'),
  ('benthams', 'Benthamsbulldog'),
  ('channel5youtube', 'Channel5iveNews'),
  ('dailydoseofinternet', 'ddofinternet'),
  ('dwarkeshpatel', 'dwarkesh_sp'),
  ('hankschannel', 'hankgreen'),
  ('joerogan', 'joerogan'),
  ('kurzgesagt', 'Kurz_Gesagt'),
  ('magmidt', 'magmidt88'),
  ('moneymacro', 'JoeriSchasfoort'),
  ('nicholasdecker', 'captgouda24'),
  ('sabinehossenfelder', 'skdh'),
  ('slowboring', 'mattyglesias'),
  ('thezvi', 'TheZvi'),
  ('verysane.ai', 'segyges')
  ) h (slug, handle)
 where p.slug = h.slug;

-- Records a creator's X account, or with a null handle that they have none.
-- Admins call it from the review page, and the runner's Claude with the
-- service key and the actor claude.
create function everything_set_x_handle(p_project_slug text, p_handle text, p_evidence text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  v_handle text := nullif(ltrim(trim(p_handle), '@'), '');
begin
  update everything_projects
     set x_handle = v_handle,
         x_handle_status = case when v_handle is null then 'none' else 'found' end,
         x_handle_evidence = nullif(trim(p_evidence), ''),
         x_handle_checked_by = v_actor,
         x_handle_checked_at = now()
   where slug = p_project_slug;
  if not found then raise exception 'There is no project %', p_project_slug; end if;
end;
$$;

alter type everything_review_field_row
  -- 'found', 'none' or 'unknown', from everything_projects.x_handle_status.
  add attribute creator_x text,
  add attribute creator_x_handle text,
  add attribute creator_x_evidence text;

-- As in migration 153, with the creator's X account.
create or replace function everything_review_field_rows(p_reviewer text, p_views everything_item_views, p_ids uuid[] default null)
returns setof everything_review_field_row
language sql stable security definer set search_path = public as $$
  with drafts as (
    select * from everything_claude_drafts where p_ids is null or id = any (p_ids)
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
     where v.note_id in (select note_id from drafts)
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
     where e.type in ('message', 'answer') and e.draft_id in (select id from drafts)
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
         p.x_handle_evidence
    from drafts d
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
    left join everything_claude_judgements j on j.draft_id = d.id and j.note = d.note
    left join everything_claude_skips s on s.draft_id = d.id and s.reviewer = p_reviewer
    left join everything_best_notes b on b.note_id = d.note_id
    left join everything_claude_few_shot_examples f on f.draft_id = d.id
    left join last_chat lc on lc.draft_id = d.id;
$$;

-- 2. The event whitelist.

alter table everything_events drop constraint everything_events_event_check;
alter table everything_events
  add constraint everything_events_event_check check (event in (
    'pageview',
    'notes_shown',
    'extension_installed',
    'extension_active',
    'sign_in_started',
    'signed_in',
    'vote_gated_login',
    'write_note_teaser_shown',
    'improvement_write_rejected',
    'note_write_rejected',
    'extension_store_clicked',
    'get_extension_clicked'));

-- 3. The click counts.

-- Since `p_since`, outside the admins' own accounts: the notes whose link was
-- opened, the most opened first (at most 50), each with its opens and the
-- devices that opened it; the clicks on each "Get the extension" button; and
-- the clicks through to each store. A note's link is its project page with
-- ?note=<id>, and its opening is that page view.
create function everything_click_counts(p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  max_notes constant int := 50;
  result jsonb;
begin
  if not everything_is_admin() then raise exception 'Only admins can read the click counts'; end if;
  with admins as (
    select u.id from auth.users u join everything_admins a on a.email = lower(u.email)
  ),
  events as (
    select e.event, e.device_id, e.props
      from everything_events e
     where e.created_at >= p_since
       and e.event in ('pageview', 'get_extension_clicked', 'extension_store_clicked')
       and (e.user_id is null or e.user_id not in (select id from admins))
  ),
  opens as (
    select substring(props ->> 'url' from '[?&]note=([0-9a-fA-F-]{36})')::uuid as note_id, device_id
      from events
     where event = 'pageview' and props ->> 'url' ~ '[?&]note=[0-9a-fA-F-]{36}'
  ),
  note_rows as (
    select o.note_id, count(*) as opens, count(distinct o.device_id) as devices, n.note, p.name as creator, p.slug
      from opens o
      left join everything_notes n on n.id = o.note_id
      left join everything_claims c on c.id = n.claim_id
      left join everything_items i on i.id = c.item_id
      left join everything_projects p on p.id = i.project_id
     group by o.note_id, n.note, p.name, p.slug
     order by count(*) desc, o.note_id
     limit max_notes
  ),
  clicks as (
    select event, coalesce(props ->> 'button', props ->> 'browser', 'unknown') as what, count(*) as clicks, count(distinct device_id) as devices
      from events
     where event in ('get_extension_clicked', 'extension_store_clicked')
     group by 1, 2
  )
  select jsonb_build_object(
    'note_opens', (select count(*) from opens),
    'notes', coalesce((select jsonb_agg(to_jsonb(r) order by r.opens desc, r.note_id) from note_rows r), '[]'),
    'get_extension', coalesce((select jsonb_agg(jsonb_build_object('button', what, 'clicks', clicks, 'devices', devices) order by clicks desc) from clicks where event = 'get_extension_clicked'), '[]'),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('browser', what, 'clicks', clicks, 'devices', devices) order by clicks desc) from clicks where event = 'extension_store_clicked'), '[]')
  ) into result;
  return result;
end;
$$;

revoke all on function everything_set_x_handle(text, text, text, text), everything_click_counts(timestamptz) from public, anon, authenticated;
grant execute on function everything_set_x_handle(text, text, text, text), everything_click_counts(timestamptz) to authenticated, service_role;

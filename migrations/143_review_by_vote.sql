-- 143: a vote is the review, and the review page grows filters, Skip and the
-- note judge (GOO-563).
--
-- Until now Jim and Nathan reviewed the Claude note writer's notes with
-- Approve and Reject buttons, and a rejection deleted the note. Now their
-- vote is the review: a Helpful or Somewhat helpful vote from either of them,
-- cast anywhere on the website or in the extension, marks the note approved,
-- and a Not helpful vote marks it disapproved. A trigger on the votes table
-- does this. A disapproved note stays on the site, like any note with a Not
-- helpful vote. Deleting a note from the site is a separate step.
--
-- The page also gets: Claude's proposed improvement of a note, which a
-- reviewer can post in place of the live note; a per-reviewer Skip; an
-- optional explanation after a vote; and the note judge's two probabilities,
-- which the runner on Nathan's ai-box stores for every note.

-- 1. The review's state on each draft.
--
-- status still says whether the note is on the site. 'removed' replaces
-- 'rejected': the note was on the site or waiting for approval, and a
-- reviewer took it off or turned it down. verdict is the review: null until
-- Jim or Nathan votes, then 'approved' or 'disapproved'. The last vote of
-- either of them decides, and reviewed_by and reviewed_at say whose and when.

alter table everything_claude_drafts drop constraint everything_claude_drafts_status_check;
update everything_claude_drafts set status = 'removed' where status = 'rejected';
alter table everything_claude_drafts add constraint everything_claude_drafts_status_check
  check (status in ('awaiting_approval', 'posted', 'removed', 'not_a_note'));

alter table everything_claude_drafts
  add column verdict text check (verdict in ('approved', 'disapproved')),
  add column proposed_note text,
  add column proposed_sources jsonb check (proposed_sources is null or jsonb_typeof(proposed_sources) = 'array');

comment on column everything_claude_drafts.verdict is
  'The review: approved or disapproved by the last vote of Jim or Nathan on the live note, or by turning down a note that waited for approval. Null until then.';
comment on column everything_claude_drafts.proposed_note is
  'Claude''s proposed improvement of the note, from a reviewer''s chat. A reviewer posts it in place of the live note, which clears it.';

-- Every old rejection was a disapproval.
update everything_claude_drafts set verdict = 'disapproved' where status = 'removed';

-- The section index of migration 130 now serves the verdict too.
drop index everything_claude_drafts_section;
create index everything_claude_drafts_section on everything_claude_drafts (status, verdict, created_at desc, id desc);

-- 2. The vote decides.

-- Which reviewer a user account is, or null for everyone but Jim and Nathan.
create function everything_reviewer_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select a.reviewer
    from auth.users u
    join everything_admins a on a.email = lower(u.email)
   where u.id = p_user and a.reviewer is not null
$$;

-- Sets the verdict of the Claude draft behind a live note from the last vote
-- Jim or Nathan cast on it. A retracted vote hands the decision back to the
-- other reviewer's vote, or to nobody. Each change of the verdict is logged
-- with the note's text, because the examples file teaches from it.
create function everything_claude_settle_verdict(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_vote int;
  v_reviewer text;
  v_at timestamptz;
  v_verdict text;
begin
  select * into d from everything_claude_drafts where note_id = p_note and status = 'posted' for update;
  if not found then return; end if;
  select v.vote, everything_reviewer_of(v.voter_id), v.updated_at into v_vote, v_reviewer, v_at
    from everything_votes v
   where v.note_id = p_note and everything_reviewer_of(v.voter_id) is not null
   order by v.updated_at desc
   limit 1;
  v_verdict := case when v_vote is null then null when v_vote >= 0 then 'approved' else 'disapproved' end;
  if v_verdict is not distinct from d.verdict and v_reviewer is not distinct from d.reviewed_by then return; end if;
  update everything_claude_drafts
     set verdict = v_verdict, reviewed_by = v_reviewer, reviewed_at = v_at, updated_at = now()
   where id = d.id;
  if v_verdict is distinct from d.verdict then
    insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
    values (coalesce(v_reviewer, d.reviewed_by), coalesce(v_verdict, 'unreviewed'), d.id, d.item_id, p_note,
            jsonb_build_object('note', d.note, 'vote', v_vote));
  end if;
end;
$$;

-- Runs after every vote, change of vote and retraction. Votes that go with a
-- deleted note are skipped: the draft keeps the verdict it had.
create function everything_votes_review_by_vote() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_note uuid := coalesce(new.note_id, old.note_id);
begin
  if everything_reviewer_of(coalesce(new.voter_id, old.voter_id)) is null then return null; end if;
  if not exists (select 1 from everything_notes where id = v_note) then return null; end if;
  perform everything_claude_settle_verdict(v_note);
  return null;
end;
$$;

create trigger everything_votes_review_by_vote
  after insert or update of vote or delete on everything_votes
  for each row execute function everything_votes_review_by_vote();

-- The verdicts of the notes approved with the old button, and then the
-- verdicts the votes already cast give. A note approved without a vote stays
-- approved.
update everything_claude_drafts set verdict = 'approved' where status = 'posted' and reviewed_by is not null;
select everything_claude_settle_verdict(d.note_id)
  from everything_claude_drafts d
 where d.status = 'posted'
   and exists (select 1 from everything_votes v where v.note_id = d.note_id and everything_reviewer_of(v.voter_id) is not null);

-- 3. The note judge's answers (GOO-591).
--
-- The runner on Nathan's ai-box asks a Claude, for each note, how likely it is
-- to be rated helpful and how likely the team would put it on the leaderboard.
-- The note's text is stored with the answer, so a rewritten note is judged
-- again.
create table everything_claude_judgements (
  draft_id uuid primary key references everything_claude_drafts (id) on delete cascade,
  note text not null,
  p_helpful float8 not null check (p_helpful between 0 and 1),
  p_impactful float8 not null check (p_impactful between 0 and 1),
  reasoning text not null,
  judged_at timestamptz not null default now()
);

-- 4. Skip, per reviewer.
create table everything_claude_skips (
  draft_id uuid not null references everything_claude_drafts (id) on delete cascade,
  reviewer text not null check (reviewer in ('jim', 'nathan')),
  at timestamptz not null default now(),
  primary key (draft_id, reviewer)
);

alter table everything_claude_judgements enable row level security;
alter table everything_claude_skips enable row level security;
revoke all on everything_claude_judgements, everything_claude_skips from anon, authenticated;
grant all on everything_claude_judgements, everything_claude_skips to service_role;

-- 5. What reviewers and Claude do.

drop function everything_claude_approve(uuid, text);
drop function everything_claude_reject(uuid, text, text);

-- A vote on a note that waits for approval. An upvote posts it as an AI note
-- and returns its id, so the page casts the vote on it through the website's
-- ordinary vote, which also records the donation and, through the trigger
-- above, the verdict. A Not helpful vote keeps it off the site.
create function everything_claude_vote_waiting(p_draft uuid, p_vote int, p_actor text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  if p_vote not in (-1, 0, 1) then raise exception 'A vote is -1, 0 or 1'; end if;
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.status <> 'awaiting_approval' then
    raise exception 'Only a note waiting for approval can be voted on here';
  end if;
  if p_vote >= 0 then
    return everything_claude_publish(d.id, 'ai', v_actor);
  end if;
  update everything_claude_drafts
     set status = 'removed', verdict = 'disapproved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, 'disapproved', d.id, d.item_id, jsonb_build_object('note', d.note, 'vote', p_vote));
  return null;
end;
$$;

-- Deletes a Claude note from the site, or turns down one that waits for
-- approval. Either way the note counts as disapproved.
create function everything_claude_delete_note(p_draft uuid, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.status not in ('posted', 'awaiting_approval') then
    raise exception 'Only a posted note or one waiting for approval can be deleted';
  end if;
  if d.note_id is not null then
    perform everything_claude_remove_note(d.note_id);
  end if;
  update everything_claude_drafts
     set status = 'removed', note_id = null, verdict = 'disapproved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'deleted', d.id, d.item_id, d.note_id, jsonb_build_object('note', d.note));
end;
$$;

-- Claude's proposed improvement, from a reviewer's chat. Only the Claude
-- session sends it, with the service key.
create function everything_claude_propose(p_draft uuid, p_note text, p_sources jsonb, p_reason text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  v_item uuid;
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'The proposed note is empty'; end if;
  update everything_claude_drafts
     set proposed_note = p_note, proposed_sources = p_sources, updated_at = now()
   where id = p_draft
  returning item_id into v_item;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, 'proposed', p_draft, v_item, jsonb_build_object('note', p_note, 'sources', p_sources, 'reason', coalesce(p_reason, '')));
end;
$$;

-- Hides a draft from the reviewer's own Not reviewed and Waiting sections, or
-- shows it there again. The other reviewer still sees it.
create function everything_claude_skip(p_draft uuid, p_skip boolean, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  if p_skip then
    insert into everything_claude_skips (draft_id, reviewer) values (p_draft, v_actor) on conflict do nothing;
  else
    delete from everything_claude_skips where draft_id = p_draft and reviewer = v_actor;
  end if;
end;
$$;

-- Why the reviewer voted the way they did. It is logged on the draft, and it
-- is also stored as the reasoning of the reviewer's vote on the live note.
create function everything_claude_explain(p_draft uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(null);
  d everything_claude_drafts;
begin
  if coalesce(trim(p_text), '') = '' then raise exception 'The explanation is empty'; end if;
  select * into d from everything_claude_drafts where id = p_draft;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'explained', d.id, d.item_id, d.note_id, jsonb_build_object('text', p_text, 'note', d.note));
  if d.note_id is not null then
    update everything_votes set reasoning = p_text where note_id = d.note_id and voter_id = auth.uid();
  end if;
end;
$$;

-- Posting a new text also uses up Claude's proposal. Otherwise the same as in
-- migration 130.
create or replace function everything_claude_rewrite(
  p_draft uuid,
  p_note text,
  p_reason text,
  p_posted_as text default null,
  p_sources jsonb default null,
  p_passage text default null,
  p_context_paragraph text default null,
  p_video_timing jsonb default null,
  p_actor text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
  v_posted_as text;
  v_author uuid;
begin
  if p_posted_as is not null and p_posted_as not in ('ai', 'me') then
    raise exception 'Post as ai or me';
  end if;
  if p_posted_as = 'me' and auth.uid() is null then
    raise exception 'Only a signed-in admin can post a note as themselves';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'The note is empty';
  end if;
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  update everything_claude_drafts
     set note = p_note,
         outcome = 'note',
         sources = coalesce(p_sources, sources),
         passage = coalesce(p_passage, passage),
         context_paragraph = case when p_passage is null then context_paragraph else p_context_paragraph end,
         video_timing = case when p_passage is null then video_timing else p_video_timing end,
         proposed_note = null,
         proposed_sources = null,
         updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, 'rewritten', d.id, d.item_id, jsonb_build_object(
    'reason', coalesce(p_reason, ''), 'previous_note', d.note, 'previous_sources', d.sources,
    'previous_passage', d.passage, 'note', p_note
  ));
  if d.status <> 'posted' or d.note_id is null then
    return null;
  end if;
  if p_posted_as = 'ai' then
    v_posted_as := 'ai';
  elsif p_posted_as = 'me' then
    v_posted_as := v_actor;
    v_author := auth.uid();
  else
    v_posted_as := d.posted_as;
    select author_id into v_author from everything_notes where id = d.note_id;
  end if;
  perform everything_claude_remove_note(d.note_id);
  return everything_claude_publish(d.id, v_posted_as, v_actor, v_author);
end;
$$;

-- 6. What the page reads.

drop function everything_claude_review_summary();
drop function everything_claude_review_page(text, timestamptz, uuid, int);
drop function everything_claude_review_drafts(uuid[]);
drop function everything_claude_review_rows(uuid[]);
drop type everything_claude_review_draft;

-- How the crowd rated a live note, for the page's filter: 'helpful' when it
-- is rated helpful, 'upvoted' when it has Helpful or Somewhat helpful votes
-- and no Not helpful vote, and 'other' for every other note, including one
-- that is not on the site. The author's own automatic vote does not count.
create function everything_claude_crowd_rating(p_note uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when everything_note_status(n.p_helpful) = 'helpful' then 'helpful'
             when n.not_helpful_count = 0
                  and n.helpful_count - (n.author_id is not null)::int + n.somewhat_helpful_count > 0 then 'upvoted'
             else 'other'
           end
      from everything_notes n
     where n.id = p_note
  ), 'other')
$$;

-- Whether a draft belongs to a section of the sidebar for this reviewer.
create function everything_claude_in_section(d everything_claude_drafts, p_section text, p_reviewer text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_section
    when 'unreviewed' then d.status = 'posted' and d.verdict is null and not skipped
    when 'waiting' then d.status = 'awaiting_approval' and not skipped
    when 'approved' then d.verdict = 'approved'
    when 'disapproved' then d.verdict = 'disapproved'
    when 'no_note' then d.status = 'not_a_note'
    when 'skipped' then skipped and d.verdict is null and d.status in ('posted', 'awaiting_approval')
  end
  from (select exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer) as skipped) k
$$;

-- The page's header: who is reviewing, the settings, and how many drafts each
-- section holds under the crowd-rating filter. A null filter lets every draft
-- through.
create function everything_claude_review_summary(p_ratings text[] default null)
returns table (
  reviewer text, writer text, approval_required boolean,
  unreviewed bigint, waiting bigint, approved bigint, disapproved bigint, no_note bigint, skipped bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
begin
  return query
  select v_reviewer, s.writer, s.approval_required, c.*
    from everything_claude_settings s,
    lateral (
      select count(*) filter (where everything_claude_in_section(d, 'unreviewed', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'waiting', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'approved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'disapproved', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'no_note', v_reviewer)),
             count(*) filter (where everything_claude_in_section(d, 'skipped', v_reviewer))
        from everything_claude_drafts d
       where p_ratings is null or everything_claude_crowd_rating(d.note_id) = any (p_ratings)
    ) c;
end;
$$;

-- One draft as the page shows it.
create type everything_claude_review_draft as (
  id uuid,
  item_id uuid,
  passage text,
  claim text,
  kind text,
  outcome text,
  note text,
  reasoning text,
  sources jsonb,
  status text,
  verdict text,
  note_id uuid,
  posted_as text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz,
  context_paragraph text,
  post_url text,
  post_title text,
  creator text,
  creator_slug text,
  proposed_note text,
  proposed_sources jsonb,
  -- The note judge's answer for the note's current text, if it has one.
  judge_p_helpful float8,
  judge_p_impactful float8,
  judge_reasoning text,
  on_leaderboard boolean,
  -- Whether the reviewer reading the page skipped the draft.
  skipped boolean,
  -- [{ at, actor, text }], oldest first: reasons of old rejections and
  -- explanations given after a vote.
  explanations jsonb,
  -- [{ at, actor, text }], oldest first.
  messages jsonb,
  -- [{ at, note, reason }], oldest first.
  earlier_versions jsonb
);

-- The drafts with these ids, newest first, as `p_reviewer` sees them. The
-- two functions below are the only callers, and each checks the caller first.
create function everything_claude_review_rows(p_ids uuid[], p_reviewer text) returns setof everything_claude_review_draft
language sql stable security definer set search_path = public as $$
  select d.id, d.item_id, d.passage, d.claim, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.verdict, d.note_id, d.posted_as, d.reviewed_by, d.reviewed_at, d.created_at, d.context_paragraph,
         i.url, i.title, p.name, p.slug,
         d.proposed_note, d.proposed_sources,
         j.p_helpful, j.p_impactful, j.reasoning,
         exists (select 1 from everything_best_notes b where b.note_id = d.note_id),
         exists (select 1 from everything_claude_skips s where s.draft_id = d.id and s.reviewer = p_reviewer),
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', e.data ->> 'reason')) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id
              and ((e.type = 'rejected' and coalesce(e.data ->> 'reason', '') <> '') or e.type = 'explained')
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', '')) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id and e.type in ('message', 'answer')
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
            where e.draft_id = d.id
              and ((e.type = 'rewritten' and coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote') is not null) or e.type = 'withdrawn')
         ), '[]'::jsonb)
    from everything_claude_drafts d
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
    left join everything_claude_judgements j on j.draft_id = d.id and j.note = d.note
   where d.id = any (p_ids)
   order by d.created_at desc, d.id desc;
$$;

-- One page of a sidebar section under the crowd-rating filter, newest first.
create function everything_claude_review_page(
  p_section text,
  p_ratings text[] default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 50;
  v_reviewer text := everything_claude_actor(null);
  v_ids uuid[];
begin
  if p_section not in ('unreviewed', 'waiting', 'approved', 'disapproved', 'no_note', 'skipped') then
    raise exception 'Unknown section %', p_section;
  end if;
  -- The keyset: rows strictly after the last row of the previous page in the
  -- order (created_at desc, id desc).
  select array_agg(d.id) into v_ids
    from (
      select d.id
        from everything_claude_drafts d
       where everything_claude_in_section(d, p_section, v_reviewer)
         and (p_ratings is null or everything_claude_crowd_rating(d.note_id) = any (p_ratings))
         and (p_before_created_at is null or (d.created_at, d.id) < (p_before_created_at, p_before_id))
       order by d.created_at desc, d.id desc
       limit least(greatest(p_limit, 1), max_page_size)
    ) d;
  return query select * from everything_claude_review_rows(coalesce(v_ids, '{}'), v_reviewer);
end;
$$;

-- A few drafts by id, so the page can refresh the ones whose chat waits for
-- Claude's answer without reloading every page.
create function everything_claude_review_drafts(p_ids uuid[]) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_ids constant int := 50;
  v_reviewer text := everything_claude_actor(null);
begin
  if cardinality(p_ids) > max_ids then raise exception 'Ask for at most % drafts', max_ids; end if;
  return query select * from everything_claude_review_rows(p_ids, v_reviewer);
end;
$$;

-- 7. Who may call what. As in migration 130, every grant is spelled out.

revoke all on function
  everything_reviewer_of(uuid),
  everything_claude_settle_verdict(uuid),
  everything_votes_review_by_vote(),
  everything_claude_vote_waiting(uuid, int, text),
  everything_claude_delete_note(uuid, text),
  everything_claude_propose(uuid, text, jsonb, text, text),
  everything_claude_skip(uuid, boolean, text),
  everything_claude_explain(uuid, text),
  everything_claude_crowd_rating(uuid),
  everything_claude_in_section(everything_claude_drafts, text, text),
  everything_claude_review_summary(text[]),
  everything_claude_review_rows(uuid[], text),
  everything_claude_review_page(text, text[], timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
from public, anon, authenticated;

grant execute on function
  everything_claude_vote_waiting(uuid, int, text),
  everything_claude_delete_note(uuid, text),
  everything_claude_skip(uuid, boolean, text),
  everything_claude_explain(uuid, text),
  everything_claude_review_summary(text[]),
  everything_claude_review_page(text, text[], timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
to authenticated, service_role;

grant execute on function everything_claude_propose(uuid, text, jsonb, text, text) to service_role;

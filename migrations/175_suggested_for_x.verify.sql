-- Checks for migration 175 against the live data. It only reads. Each column
-- should be true; a false one names the part of the rule a suggestion breaks.
with s as (
  select n.*, c.item_id, b.note_id is not null as on_leaderboard
    from everything_x_suggestions() x
    join everything_notes n on n.id = x.note_id
    join everything_claims c on c.id = n.claim_id
    left join everything_best_notes b on b.note_id = n.id
)
select
  (select count(*) <= 5 from s) as at_most_five,
  not exists (select 1 from s join everything_note_x_marks m on m.note_id = s.id) as none_marked_on_x,
  not exists (select 1 from s where status = 'hidden' or improved_from_note_id is not null or feed_band = 'stale') as all_live_originals,
  (select count(distinct item_id) = count(*) from s) as one_per_post,
  not exists (
    select 1 from s join everything_votes v on v.note_id = s.id
     where v.vote < 0 and everything_reviewer_of(v.voter_id) is not null
  ) as no_team_not_helpful,
  not exists (select 1 from s where not on_leaderboard and (p_helpful < 0.74 or created_at < now() - interval '14 days')) as all_promising,
  (select count(*) from everything_review_field_rows(null, everything_item_views()) f where f.suggested_x)
    = (select count(*) from s) as review_page_marks_them;

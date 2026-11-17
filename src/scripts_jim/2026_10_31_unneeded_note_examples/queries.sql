-- The queries behind findings.md, run through sql.py against prod on 2026-10-31.
-- Admin voter ids: Jim 0e97e940-652f-466b-8693-c142257e083d, Nathan 963d0c31-33e5-47da-8aa1-386bc3289efb and da00486d-5b45-4860-8f2f-990939eee8d9.

-- 1. Claude Code drafts on Common Notes that the admins disapproved or commented on (disapproved.json).
select d.id draft_id, d.note_id, d.status, d.passage, d.note, d.review_note, d.review_note_by, i.url, d.created_at
from everything_claude_drafts d join everything_items i on i.id=d.item_id
where d.verdict='disapproved' or d.review_note is not null order by d.created_at;

-- 2. Pipeline notes on Common Notes with a Not helpful vote from Jim or Nathan, with the research model (pipeline_downvoted.json).
-- Only the rows whose search arm is opus5-native or sonnet5-native were read.
with dv as (
 select v.note_id from everything_votes v
 where v.voter_id in ('0e97e940-652f-466b-8693-c142257e083d','963d0c31-33e5-47da-8aa1-386bc3289efb','da00486d-5b45-4860-8f2f-990939eee8d9')
 group by v.note_id having min(v.vote) = -1)
select n.id note_id, n.note, c.context_quote, i.url, r.ab_test_picks->>'simple_bot_search' search_arm
from dv join everything_notes n on n.id=dv.note_id join everything_claims c on c.id=n.claim_id join everything_items i on i.id=c.item_id
left join lateral (select * from everything_pipeline_runs r where r.claim_id=c.id and r.kind='check' order by created_at desc limit 1) r on true
where n.author_id is null and not exists (select 1 from everything_claude_drafts d where d.note_id=n.id);

-- 3. Our X notes from strong research models where "note not needed" is most of the Not helpful ratings
--    and "incorrect" is rare (x_candidates.json).
select nt.note_id, nt.tweet_id, nt.cn_status, nt.note_text, coalesce(pr.ab_test_picks->>'simple_bot_search', pr.bot_name) model,
 r.helpful_count h, r.not_helpful_count nh, r.not_helpful_tag_counts
from notes nt join pipeline_runs pr on pr.note_id=nt.note_id join note_ratings_from_public_dump r on r.note_id=nt.note_id
where (pr.ab_test_picks->>'simple_bot_search' ~ '(sonnet|opus|sol|terra|astra|pro-native|gpt5-native)' or pr.bot_name ~ '^opus')
 and r.not_helpful_count >= 6
 and (r.not_helpful_tag_counts->>'notHelpfulNoteNotNeeded')::int >= 0.6 * r.not_helpful_count
 and coalesce((r.not_helpful_tag_counts->>'notHelpfulIncorrect')::int,0) <= 0.15 * r.not_helpful_count
 and r.not_helpful_count > r.helpful_count;

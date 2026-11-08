-- Checks migration 177 against the live data. It only reads. Run it an hour
-- or more after applying; each column should be true.
with posted as (
  select n.notewriter_id, d.item_id, n.created_at
    from everything_claude_drafts d
    join everything_notes n on n.id = d.note_id
   where d.posted_as = 'ai' and n.created_at > now() - interval '1 hour'
)
select
  (select bool_and(prosrc not like '%notewriter_add_note(''claude-ai-box''%')
     from pg_proc where proname = 'everything_claude_publish') as publish_reads_assignment,
  not exists (
    select 1 from posted p
     where p.notewriter_id is distinct from coalesce((
       select a.notewriter_id from everything_assignments a
        where a.item_id = p.item_id and a.started_at <= p.created_at
          and (a.ended_at is null or a.ended_at >= p.created_at)
        order by a.started_at desc limit 1), 'claude-ai-box')
  ) as notes_in_last_hour_match_their_assignment;

-- What the reader did with the draft Opus wrote in answer to a question. Until
-- now the reader's page only remembered this while the conversation was open,
-- so reopening it offered the same draft again and it could be posted twice.
-- `draft_outcome` is null while the draft waits for the reader. `draft_posted_id`
-- is the note or highlight the reader posted from it, so the conversation can
-- show and link it.
alter table everything_passage_questions
  add column draft_outcome text check (draft_outcome in ('posted', 'discarded')),
  add column draft_posted_id uuid;

-- The reader may record the outcome on their own questions, and nothing else.
grant update (draft_outcome, draft_posted_id) on everything_passage_questions to authenticated;
create policy passage_questions_update_own on everything_passage_questions for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

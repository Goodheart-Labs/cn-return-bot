create table everything_passage_questions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  passage text not null check (char_length(passage) between 1 and 20000),
  question text not null check (char_length(question) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'answering', 'done', 'error')),
  answer text,
  draft jsonb,
  error text,
  model text,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  answered_at timestamptz
);
create index everything_passage_questions_inbox on everything_passage_questions(created_at) where status = 'pending';
create index everything_passage_questions_author on everything_passage_questions(author_id, created_at);

create function everything_limit_passage_questions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The user row serializes concurrent submissions, including across UTC midnight.
  perform 1 from auth.users where id = new.author_id for update;
  new.created_at := clock_timestamp();
  if (select count(*) from everything_passage_questions
      where author_id = new.author_id
        and created_at >= date_trunc('day', new.created_at at time zone 'UTC') at time zone 'UTC') >= 20 then
    raise exception 'Daily question limit reached (20)';
  end if;
  return new;
end $$;
create trigger everything_passage_questions_limit before insert on everything_passage_questions
  for each row execute function everything_limit_passage_questions();

create function everything_passage_question_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cost_usd > old.cost_usd then
    insert into everything_pipeline_runs(kind, outcome, cost, logs)
    values ('other', 'passage_question', new.cost_usd - old.cost_usd, jsonb_build_object('passage_question_id', new.id));
  end if;
  return new;
end $$;
create trigger everything_passage_questions_cost after update of cost_usd on everything_passage_questions
  for each row execute function everything_passage_question_cost();

alter table everything_passage_questions enable row level security;
grant select on everything_passage_questions to authenticated;
grant insert (item_id, author_id, passage, question) on everything_passage_questions to authenticated;
grant all on everything_passage_questions to service_role;
create policy passage_questions_read_own on everything_passage_questions for select to authenticated using (author_id = auth.uid());
create policy passage_questions_insert_own on everything_passage_questions for insert to authenticated with check (author_id = auth.uid());
alter publication supabase_realtime add table everything_passage_questions;

alter table everything_note_requests
  add column steer text check (char_length(steer) <= 500),
  add column passage_question_id uuid unique references everything_passage_questions(id) on delete set null;

alter table everything_note_requests drop constraint everything_note_requests_selection_check;
alter table everything_note_requests add constraint everything_note_requests_selection_check
  check (selection is null or char_length(selection) between 1 and case when passage_question_id is null then 2000 else 20000 end);

-- Only intake may link a question to the note work it requested.
drop policy note_requests_insert on everything_note_requests;
create policy note_requests_insert on everything_note_requests for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and status = 'pending' and item_id is null and passage_question_id is null);

alter table everything_items add column request_steer text check (char_length(request_steer) <= 500);

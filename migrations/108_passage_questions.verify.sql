begin;
do $$
declare
  reader uuid := gen_random_uuid();
  item uuid;
  question_id uuid;
  total numeric;
begin
  insert into auth.users(id) values (reader);
  insert into everything_items(project_id, source, url, title, status)
    values ((select id from everything_projects limit 1), 'web', 'https://example.com/passage-limit-verify', 'Verify', 'done') returning id into item;
  for n in 1..20 loop
    insert into everything_passage_questions(item_id, author_id, passage, question, created_at)
      values (item, reader, 'A passage to check', 'Question ' || n, now() - interval '2 days') returning id into question_id;
  end loop;
  if (select count(*) from everything_passage_questions where author_id = reader and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') <> 20 then
    raise exception 'Client timestamps bypassed the daily window';
  end if;
  begin
    insert into everything_passage_questions(item_id, author_id, passage, question) values (item, reader, 'A passage to check', 'Question 21');
    raise exception 'Expected the 21st question to fail';
  exception when raise_exception then
    if sqlerrm <> 'Daily question limit reached (20)' then raise; end if;
  end;
  update everything_passage_questions set created_at = now() - interval '2 days' where author_id = reader;
  insert into everything_passage_questions(item_id, author_id, passage, question) values (item, reader, 'A passage to check', 'New day') returning id into question_id;
  update everything_passage_questions set cost_usd = 0.1 where id = question_id;
  update everything_passage_questions set cost_usd = 0.3 where id = question_id;
  update everything_passage_questions set cost_usd = 0.3 where id = question_id;
  select sum(cost) into total from everything_pipeline_runs where logs->>'passage_question_id' = question_id::text;
  if total <> 0.3 then raise exception 'Question costs counted incorrectly: %', total; end if;
end $$;
rollback;

-- In two sessions, insert the twentieth and twenty-first questions for the same
-- reader concurrently: the auth.users row lock makes one wait and then reject.

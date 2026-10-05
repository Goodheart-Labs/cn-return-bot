-- 114: what the website and the extension may write, and a daily ceiling on
-- reader-requested spend (GOO-346).
--
-- 1. Clients insert only the columns the apps send. Everything else on a new
--    row comes from the column defaults, so a reader's web item starts as a
--    finished page, and a reader's note starts with no votes.
-- 2. The database writes the author name of a signed note itself, from the
--    account's X identity or email address.
-- 3. Text that readers write has length limits, and each table that readers
--    write to takes at most a fixed number of new reader rows per hour or day.
-- 4. Every pipeline cost row says whether it was spent for a reader or for the
--    feed, so the pipeline can stop reader work at its own daily ceiling.
-- 5. A press on a creator never grants more than seven days of priority.
-- 6. A vote's donation amounts stay within what the formula can produce.

-- ---------------------------------------------------------------------------
-- 1. Column grants.
--
--    Revoking the table-wide insert privilege also revokes every column
--    privilege, so each grant below is the complete list of what a client may
--    send. The lists match what everything-core sends today.

revoke insert on everything_items from authenticated;
grant insert (project_id, source, url, title, status) on everything_items to authenticated;
drop policy items_insert_web on everything_items;
create policy items_insert_web on everything_items for insert to authenticated
  with check (source = 'web' and status = 'done');

revoke insert on everything_claims from authenticated;
grant insert (item_id, claim, judgement, context_quote, context_paragraph, context_url, status, created_by)
  on everything_claims to authenticated;
drop policy insert_own_claims on everything_claims;
create policy insert_own_claims on everything_claims for insert to authenticated
  with check (created_by = auth.uid() and status = 'note' and judgement = 'user');

revoke insert on everything_notes from authenticated;
grant insert (claim_id, note, author_id, author_name, improved_from_note_id, status)
  on everything_notes to authenticated;

revoke insert on everything_note_not_needed from authenticated;
grant insert (claim_id, author_id, author_name, body) on everything_note_not_needed to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The author name of a signed note, key point or forecast.
--
--    The client still decides whether the post is signed: it sends a name to
--    sign and null to stay anonymous. When it sends a name, this trigger
--    replaces it with the name the account really has. It uses the same order
--    as displayName() in everything-core/session.ts: the X handle, then the X
--    display name, then the part of the email address before the @.
--    The X values come from auth.identities, which X fills in at sign-in.
--    They do not come from the user metadata, because an account can change
--    its own metadata.

create function everything_fill_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null and new.author_name is not null then
    new.author_name := coalesce(
      (select coalesce(identity_data->>'user_name', identity_data->>'full_name')
         from auth.identities
        where user_id = new.author_id and provider = 'twitter'
        limit 1),
      (select nullif(split_part(email, '@', 1), '') from auth.users where id = new.author_id),
      'anonymous'
    );
  end if;
  return new;
end $$;

create trigger everything_notes_author_name before insert on everything_notes
  for each row execute function everything_fill_author_name();
create trigger everything_note_not_needed_author_name before insert on everything_note_not_needed
  for each row execute function everything_fill_author_name();
create trigger everything_passage_highlights_author_name before insert on everything_passage_highlights
  for each row execute function everything_fill_author_name();

-- ---------------------------------------------------------------------------
-- 3a. Length limits on text that readers write.
--
--    Rows the pipeline writes carry no author and keep their old freedom. A
--    pipeline claim can hold a whole article, for example.

alter table everything_items add constraint everything_items_url_shape
  check (url ~* '^https?://' and char_length(url) <= 2048);
alter table everything_items add constraint everything_items_title_length
  check (char_length(title) <= 1000);

alter table everything_claims add constraint everything_claims_reader_text_length
  check (created_by is null or (
    char_length(claim) <= 300
    and char_length(context_quote) <= 20000
    and char_length(context_paragraph) <= 20000
    and char_length(context_url) <= 2048
  ));

alter table everything_notes add constraint everything_notes_reader_text_length
  check (author_id is null or (char_length(note) <= 2000 and char_length(author_name) <= 100));

alter table everything_note_not_needed add constraint everything_note_not_needed_text_length
  check (char_length(body) <= 2000 and char_length(author_name) <= 100);

alter table everything_passage_highlights add constraint everything_passage_highlights_text_length
  check (char_length(context_paragraph) <= 20000 and char_length(author_name) <= 100);

alter table everything_votes add constraint everything_votes_reasoning_length
  check (char_length(reasoning) <= 2000);

-- ---------------------------------------------------------------------------
-- 3b. Ceilings on new reader rows.
--
--    The trigger counts the reader rows a table gained in a recent window and
--    refuses the insert once the count reaches the ceiling. Each trigger names
--    its own ceiling, window, time column and which rows are readers' rows.
--    The ceilings sit far above the busiest hour so far (checked 2026-10-05):
--
--    | table                          | ceiling      | busiest so far |
--    |--------------------------------|--------------|----------------|
--    | everything_note_requests       | 100 per day  | 5 in an hour   |
--    | everything_link_visits         | 1000 an hour | 178            |
--    | everything_events              | 1000 an hour | 149            |
--    | everything_items (reader rows) | 200 an hour  | 2              |
--    | everything_claims (reader)     | 100 an hour  | 3              |
--    | everything_notes (reader)      | 100 an hour  | 3              |
--    | everything_note_not_needed     | 100 an hour  | 3              |
--    | everything_passage_highlights  | 100 an hour  | 5              |
--
--    Only requests made with the public key or a reader's session are counted
--    and limited. The pipeline's service key is never limited.
--    auth.role() reads the role from the request's token. It is a session
--    setting, not current_user, so it stays honest inside this SECURITY
--    DEFINER function. The function must be a definer because readers cannot
--    read most of these tables.
--
--    The trigger also stamps the time column with the current time. A client
--    cannot then backdate its rows out of the window.
--    A row-level BEFORE trigger sees the rows that the same statement inserted
--    before it, so a batch insert is counted row by row too.

create function everything_cap_reader_inserts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  max_rows int := tg_argv[0]::int;
  time_window interval := tg_argv[1]::interval;
  time_column text := tg_argv[2];
  reader_rows text := tg_argv[3];
  recent int;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(time_column, now()));
  execute format('select count(*) from %I where %I > now() - $1 and (%s)', tg_table_name, time_column, reader_rows)
    into recent using time_window;
  if recent >= max_rows then
    raise exception 'Too many new entries in % right now. Please try again later.', tg_table_name
      using errcode = 'program_limit_exceeded';
  end if;
  return new;
end $$;

create trigger everything_note_requests_cap before insert on everything_note_requests
  for each row execute function everything_cap_reader_inserts('100', '1 day', 'created_at', 'true');
create trigger everything_link_visits_cap before insert on everything_link_visits
  for each row execute function everything_cap_reader_inserts('1000', '1 hour', 'visited_at', 'true');
create trigger everything_events_cap before insert on everything_events
  for each row execute function everything_cap_reader_inserts('1000', '1 hour', 'created_at', 'true');
create trigger everything_items_cap before insert on everything_items
  for each row execute function everything_cap_reader_inserts('200', '1 hour', 'created_at', 'checked_scope is null');
create trigger everything_claims_cap before insert on everything_claims
  for each row execute function everything_cap_reader_inserts('100', '1 hour', 'created_at', 'created_by is not null');
create trigger everything_notes_cap before insert on everything_notes
  for each row execute function everything_cap_reader_inserts('100', '1 hour', 'created_at', 'author_id is not null');
create trigger everything_note_not_needed_cap before insert on everything_note_not_needed
  for each row execute function everything_cap_reader_inserts('100', '1 hour', 'created_at', 'author_id is not null');
create trigger everything_passage_highlights_cap before insert on everything_passage_highlights
  for each row execute function everything_cap_reader_inserts('100', '1 hour', 'created_at', 'true');

-- The counts above read recent rows by time. These indexes keep each count to
-- the window's rows. The other tables already have a fitting index.
create index everything_note_requests_created_at on everything_note_requests (created_at);
create index everything_items_reader_created_at on everything_items (created_at) where checked_scope is null;
create index everything_claims_reader_created_at on everything_claims (created_at) where created_by is not null;
create index everything_note_not_needed_created_at on everything_note_not_needed (created_at);
create index everything_passage_highlights_created_at on everything_passage_highlights (created_at);

-- ---------------------------------------------------------------------------
-- 4. Reader spend.
--
--    Older rows keep a null here. Only today's rows matter to the ceiling, so
--    they need no backfill.

alter table everything_pipeline_runs add column work_priority text
  check (work_priority in ('reader', 'feed'));
comment on column everything_pipeline_runs.work_priority is
  'Whether the cost was spent on a page or question a reader asked for (reader) or on the feed (feed). Null on rows written before migration 114.';

create or replace function everything_passage_question_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cost_usd > old.cost_usd then
    insert into everything_pipeline_runs(kind, outcome, cost, logs, work_priority)
    values ('other', 'passage_question', new.cost_usd - old.cost_usd, jsonb_build_object('passage_question_id', new.id), 'reader');
  end if;
  return new;
end $$;

create function everything_reader_cost_since(since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost), 0) from everything_pipeline_runs where created_at >= since and work_priority = 'reader';
$$;

-- Revoking public also strips service_role's inherited execute, so grant it
-- back explicitly. The pipeline is the only caller.
revoke execute on function everything_reader_cost_since(timestamptz) from public, anon, authenticated;
grant execute on function everything_reader_cost_since(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. A press grants at most seven days, whoever calls the helper.

create or replace function everything_extend_priority(target_feed_url text, granted timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  select id into found_id from everything_projects where lower(feed_url) = lower(target_feed_url);
  if not found then
    return false;
  end if;
  -- least() caps the grant at seven days from now. greatest() keeps a longer
  -- window that the pipeline set.
  update everything_projects
     set priority_until = greatest(priority_until, least(granted, now() + interval '7 days'))
   where id = found_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Donation amounts.
--
--    The client prices a vote's donation pair with donationPair() in
--    everything-core/donationScoring.ts and saves it with an upsert. A changed
--    vote updates the pair, so readers keep the right to update the amounts.
--    They may never write amount_usd, the amount actually paid out.
--
--    The formula's largest possible amount is 12.75 USD: the 0.25 USD tip, plus
--    6.25 USD for the largest stake, plus 6.25 USD for the largest score change.
--    The largest real amount so far is 3.08 USD (checked 2026-10-05).

revoke insert, update on everything_donations from authenticated;
grant insert (vote_id, charity, amount_if_helpful, amount_if_not_helpful) on everything_donations to authenticated;
grant update (vote_id, charity, amount_if_helpful, amount_if_not_helpful) on everything_donations to authenticated;

alter table everything_donations add constraint everything_donations_amount_range
  check (amount_if_helpful between 0 and 13 and amount_if_not_helpful between 0 and 13);

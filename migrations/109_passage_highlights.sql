create table everything_passage_highlights (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items(id) on delete cascade,
  kind text not null check (kind in ('forecast', 'key_point')),
  quote text not null check (char_length(quote) between 1 and 20000),
  context_paragraph text not null,
  statement text not null check (char_length(statement) between 1 and 2000),
  probability int,
  check ((kind = 'forecast' and probability is not null and probability between 0 and 100)
      or (kind = 'key_point' and probability is null)),
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  helpful_count int not null default 0,
  somewhat_helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  created_at timestamptz not null default now()
);
create index everything_passage_highlights_item_idx on everything_passage_highlights(item_id);

create table everything_passage_highlight_votes (
  entry_id uuid not null references everything_passage_highlights(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (1, 0, -1)),
  created_at timestamptz not null default now(),
  primary key (entry_id, voter_id)
);

create or replace function everything_apply_highlight_vote()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update everything_passage_highlights set
      helpful_count          = helpful_count          - (old.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count - (old.vote = 0)::int,
      not_helpful_count      = not_helpful_count      - (old.vote = -1)::int
    where id = old.entry_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update everything_passage_highlights set
      helpful_count          = helpful_count          + (new.vote = 1)::int,
      somewhat_helpful_count = somewhat_helpful_count + (new.vote = 0)::int,
      not_helpful_count      = not_helpful_count      + (new.vote = -1)::int
    where id = new.entry_id;
  end if;
  return coalesce(new, old);
end $$;

create trigger everything_passage_highlight_votes_counter
  after insert or update or delete on everything_passage_highlight_votes
  for each row execute function everything_apply_highlight_vote();

create or replace function everything_selfvote_highlight()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null then
    insert into everything_passage_highlight_votes(entry_id, voter_id, vote)
    values (new.id, new.author_id, 1)
    on conflict (entry_id, voter_id) do nothing;
  end if;
  return new;
end $$;

create trigger everything_passage_highlights_selfvote
  after insert on everything_passage_highlights
  for each row execute function everything_selfvote_highlight();

alter table everything_passage_highlights enable row level security;
alter table everything_passage_highlight_votes enable row level security;

grant select on everything_passage_highlights to anon, authenticated;
grant insert (item_id, kind, quote, context_paragraph, statement, probability, author_id, author_name) on everything_passage_highlights to authenticated;
grant delete on everything_passage_highlights to authenticated;
grant all on everything_passage_highlights, everything_passage_highlight_votes to service_role;
grant select, insert, update, delete on everything_passage_highlight_votes to authenticated;

create policy anon_read_highlight on everything_passage_highlights for select
  to anon, authenticated using (true);
create policy insert_own_highlight on everything_passage_highlights for insert
  to authenticated with check (author_id = auth.uid());
create policy delete_own_highlight on everything_passage_highlights for delete
  to authenticated using (author_id = auth.uid());

create policy own_highlight_votes_select on everything_passage_highlight_votes for select
  to authenticated using (voter_id = auth.uid());
create policy own_highlight_votes_insert on everything_passage_highlight_votes for insert
  to authenticated with check (voter_id = auth.uid());
create policy own_highlight_votes_update on everything_passage_highlight_votes for update
  to authenticated using (voter_id = auth.uid());
create policy own_highlight_votes_delete on everything_passage_highlight_votes for delete
  to authenticated using (voter_id = auth.uid());

alter publication supabase_realtime add table everything_passage_highlights;

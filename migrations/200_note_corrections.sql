-- 200: the corrections page on commonnotes.net/corrections, and finding
-- corrections without anyone telling us.
--
-- A note gets on the page in one of two ways.
--
-- 1. The post changed. Migration 056 gave a claim `updated_quote`: what the
--    post says now, where it used to say the passage the note quotes. Until
--    now it was filled by hand, once, for six claims. The daily job
--    src/everything/spotChangedQuotes.ts now reads each post again and fills
--    it. quote_updated_at records when, and stays set if an admin clears
--    updated_quote because the job got it wrong, so the job never refills it.
--
-- 2. An admin adds the note on the page with a link that shows the author
--    corrected the post (their reply, an edit notice). Every such row must
--    carry that link: we do not publish "the author corrected this" without
--    something a reader can check.

alter table everything_claims add column quote_updated_at timestamptz;
-- The six claims of migration 056 were corrected on 2026-07-14.
update everything_claims set quote_updated_at = '2026-07-14' where updated_quote is not null;

create function everything_stamp_quote_update() returns trigger language plpgsql as $$
begin
  if new.updated_quote is not null and old.updated_quote is null then
    new.quote_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger everything_claims_stamp_quote_update
  before update of updated_quote on everything_claims
  for each row execute function everything_stamp_quote_update();

create table everything_note_corrections (
  note_id      uuid primary key references everything_notes (id) on delete cascade,
  evidence_url text not null check (evidence_url ~ '^https://[^[:space:]]+$'),
  corrected_at timestamptz not null default now()
);

create index everything_note_corrections_recent on everything_note_corrections (corrected_at desc, note_id desc);

alter table everything_note_corrections enable row level security;
grant all on everything_note_corrections to service_role;

-- Readers get the list through everything_corrections_page, which leaves out
-- hidden notes. Only admins read the table itself.
create policy note_corrections_admin_read on everything_note_corrections for select to authenticated
  using (everything_is_admin());
grant select on everything_note_corrections to authenticated;

create policy note_corrections_admin_insert on everything_note_corrections for insert to authenticated
  with check (everything_is_admin());
grant insert (note_id, evidence_url) on everything_note_corrections to authenticated;

create policy note_corrections_admin_delete on everything_note_corrections for delete to authenticated
  using (everything_is_admin());
grant delete on everything_note_corrections to authenticated;

-- One page of the corrections, the most recent first, starting after the row
-- the last page ended on. evidence_url is null for a note whose post we found
-- changed; its card already says what the post reads now. Left out: a hidden
-- note, a note without a claim (the twin of an X note), an improvement of
-- another note, and a note readers rated not helpful. The last two apply only to
-- changes we found; a row an admin added shows whatever its rating.
create function everything_corrections_page(
  p_after_at timestamptz default null,
  p_after_note_id uuid default null,
  p_limit int default 30
) returns table (note_id uuid, evidence_url text, corrected_at timestamptz)
language sql stable security definer set search_path = public as $$
  with listed as (
    select c.note_id, c.evidence_url, c.corrected_at
      from everything_note_corrections c
    union all
    select n.id, null, cl.quote_updated_at
      from everything_claims cl
      join everything_notes n on n.claim_id = cl.id
     where cl.updated_quote is not null and cl.quote_updated_at is not null
       and n.improved_from_note_id is null
       and everything_note_status(n.p_helpful) <> 'not_helpful'
       and not exists (select 1 from everything_note_corrections c where c.note_id = n.id)
  )
  select l.note_id, l.evidence_url, l.corrected_at
    from listed l
    join everything_notes n on n.id = l.note_id and n.status <> 'hidden' and n.claim_id is not null
   where p_after_note_id is null or (l.corrected_at, l.note_id) < (p_after_at, p_after_note_id)
   order by l.corrected_at desc, l.note_id desc
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function everything_corrections_page(timestamptz, uuid, int) from public;
grant execute on function everything_corrections_page(timestamptz, uuid, int) to anon, authenticated, service_role;

-- The passages the daily job reads again: on a text post, quoted by a visible
-- note with at least one Helpful vote, and never marked as changed before.
create function everything_quote_check_candidates()
returns table (claim_id uuid, item_id uuid, context_quote text, url text)
language sql stable security definer set search_path = public as $$
  select cl.id, i.id, cl.context_quote, i.url
    from everything_claims cl
    join everything_items i on i.id = cl.item_id
   where cl.context_quote is not null and cl.updated_quote is null and cl.quote_updated_at is null
     and i.source in ('substack', 'lesswrong') and i.full_text is not null
     and exists (select 1 from everything_notes n
                  where n.claim_id = cl.id and n.status <> 'hidden' and n.helpful_count >= 1);
$$;
revoke all on function everything_quote_check_candidates() from public;
grant execute on function everything_quote_check_candidates() to service_role;

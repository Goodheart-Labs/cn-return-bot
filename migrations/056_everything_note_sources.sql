-- ---------------------------------------------------------------------------
-- Move a note's citations out of the everything_notes.sources jsonb array into a
-- dedicated table: one row per supporting snippet. The source verifier
-- (verifier_citations) extracts a verbatim quote + plain-language explanation
-- for each accepted source; those are stored here and shown in the SPA behind
-- the note's ⋯ menu. A source with no extracted quote is a single quote=null row
-- so the URL still renders.
-- ---------------------------------------------------------------------------

create table everything_note_sources (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references everything_notes(id) on delete cascade,
  url         text not null,
  quote       text,          -- verbatim supporting snippet from the source (null = URL only)
  explanation text,          -- plain-language note on how the quote supports the note
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index everything_note_sources_note_id_idx on everything_note_sources(note_id);

-- Public read (the anon key is baked into the SPA); mirrors everything_notes.
alter table everything_note_sources enable row level security;
grant select on everything_note_sources to anon, authenticated;
create policy anon_read_note_sources on everything_note_sources
  for select to anon, authenticated using (true);

-- Backfill existing notes' URLs (no quote/explanation), preserving order.
insert into everything_note_sources (note_id, url, sort_order)
select n.id, elem.url, elem.ord - 1
from everything_notes n,
     jsonb_array_elements_text(n.sources) with ordinality as elem(url, ord);

alter table everything_notes drop column sources;

-- What kind of AI check an everything_items row stands for. Until now
-- `status = 'done'` meant three different things. The pipeline read the whole
-- page. Or the pipeline read only the paragraph a reader highlighted. Or a
-- reader wrote their own note and no pipeline run ever happened, because
-- ensureWebItem inserts such a row already marked done.
-- Only the first should block a new "check this page" request. So the intent
-- of the queue row is now recorded explicitly:
--   whole page checked  <=>  status = 'done' and checked_scope = 'page'
-- Null is the safe default. A client-created row, or a row inserted by an
-- extension build older than this migration, reads as never checked.

alter table everything_items
  add column checked_scope text check (checked_scope in ('page', 'paragraph'));

comment on column everything_items.checked_scope is
  'What the pipeline was asked to read. page = the whole article or transcript. paragraph = only the passage a reader highlighted, which is what full_text holds. null = no pipeline run was ever intended, because a reader-written note created this row.';

-- Backfill. Three signals in the existing data separate the states.
-- processed_at is null on a row the worker never finished, and ensureWebItem
-- does not set it. A claim without created_by exists only where the pipeline
-- extracted it, so it proves a real run even on a legacy row that was marked
-- done without a processed_at. And a paragraph check stored the reader's
-- selection as the item's entire body, so the item's full_text still equals
-- the selection on the request row that created it.
update everything_items i
set checked_scope = case
      when exists (
        select 1 from everything_note_requests r
        where r.item_id = i.id
          and r.selection is not null
          and r.selection = i.full_text
      ) then 'paragraph'
      else 'page'
    end
where i.processed_at is not null
   or i.status in ('queued', 'processing', 'error')
   or exists (select 1 from everything_claims c where c.item_id = i.id and c.created_by is null);

-- Rows the update left null are exactly the write-anywhere set: done, never
-- processed, and without any pipeline claim.

-- Clients may still only insert write-anywhere rows, and they may not claim
-- that a check happened. An older extension build omits both columns, so it
-- keeps passing this policy unchanged.
drop policy items_insert_web on everything_items;
create policy items_insert_web on everything_items
  for insert to authenticated
  with check (source = 'web' and checked_scope is null and processed_at is null);

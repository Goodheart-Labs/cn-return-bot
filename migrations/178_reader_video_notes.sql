-- 178: readers may write their own note on a stretch of a YouTube video
-- (GOO-746).
--
-- A reader's note on a video is tied to a time range, never to caption lines.
-- Its claim row carries the range in start_seconds and end_seconds, which the
-- extension's video overlay already reads for the pipeline's claims. A video
-- nobody has checked yet gets its item row from the reader, like a web page
-- does, but with the source 'youtube'. The worker reads an item by its source,
-- so a video filed as 'web' would later be fetched as a web page.

-- ---------------------------------------------------------------------------
-- 1. Readers may send the two time columns.
--
--    Migration 114 lists every column a reader may insert. This adds the two
--    time columns to that list.

grant insert (start_seconds, end_seconds) on everything_claims to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A reader's time range must make sense.
--
--    The rule only binds rows a reader wrote, which migration 114 tells apart
--    by created_by. A reader row has either no times at all, as on a web page,
--    or both times. The range starts at 0 or later, ends after it starts, and
--    is at most 120 seconds long. The extension's editor has the same limit,
--    MAX_VIDEO_NOTE_SECONDS in src/everything-core/videoTime.ts. Pipeline rows
--    keep their freedom.
--    No reader row had a time before this migration (checked 2026-11-09), so
--    the rule holds for every existing row.

alter table everything_claims add constraint everything_claims_reader_time_range
  check (created_by is null
    or (start_seconds is null and end_seconds is null)
    or (start_seconds is not null and end_seconds is not null
        and start_seconds >= 0
        and end_seconds > start_seconds
        and end_seconds - start_seconds <= 120));

-- ---------------------------------------------------------------------------
-- 3. Readers may create a video's item.
--
--    Until now readers could only create items with the source 'web'. A video
--    item must have the one address form the extension writes, the watch page
--    with the video id and nothing else. All but 2 of the 3,716 YouTube items
--    in production have that form (checked 2026-11-09). The policy gets a new
--    name, because it no longer covers only web pages.

drop policy items_insert_web on everything_items;
create policy items_insert_reader on everything_items for insert to authenticated
  with check (
    status = 'done'
    and (source = 'web'
      or (source = 'youtube' and url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'))
  );

notify pgrst, 'reload schema';

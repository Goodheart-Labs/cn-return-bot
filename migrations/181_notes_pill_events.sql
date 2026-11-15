-- 181: the "N notes on this page" pill (components/NotesAheadPill.tsx).
--   notes_pill_shown    a page loaded with every noted passage below the window,
--                       so the pill appeared; once per page address
--   notes_pill_clicked  the reader pressed it and jumped to the first note
-- Both carry props.item_id and props.note_count. Clicks over shown is the
-- pill's own rate; note_seen per reader on pages that showed it, before and
-- after the release, is its effect on the key number.
-- Apply before the extension release that sends them: a refused event is only
-- logged in the browser console.

alter table everything_events drop constraint everything_events_event_check;
alter table everything_events
  add constraint everything_events_event_check check (event in (
    'pageview',
    'notes_shown',
    'note_seen',
    'note_opened',
    'notes_pill_shown',
    'notes_pill_clicked',
    'extension_installed',
    'extension_active',
    'sign_in_started',
    'signed_in',
    'vote_gated_login',
    'write_note_teaser_shown',
    'improvement_write_rejected',
    'note_write_rejected',
    'extension_store_clicked',
    'get_extension_clicked'));

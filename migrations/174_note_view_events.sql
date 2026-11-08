-- 171: per-note view events from the extension. notes_shown says how many
-- notes a page showed; these say which ones (src/everything-extension/utils/noteViews.ts).
--   note_seen    a note's marker or card was at least half on screen for a
--                second, once per note per page address
--   note_opened  the reader opened the note's card
-- Each row carries props.surface ('inline' or 'youtube') and props.note_ids, a
-- batch of up to 30 note ids. A note's views:
--   select n.id, count(*) from everything_events e,
--     jsonb_array_elements_text(e.props->'note_ids') n(id)
--   where e.event = 'note_seen' group by n.id;
-- Apply before the extension release that sends them: a refused event is only
-- logged in the browser console.

alter table everything_events drop constraint everything_events_event_check;
alter table everything_events
  add constraint everything_events_event_check check (event in (
    'pageview',
    'notes_shown',
    'note_seen',
    'note_opened',
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

-- 103: extension_store_clicked joins the event whitelist. The website's corner
-- card (src/everything-web/src/components/ExtensionCornerLink.tsx) sends it when
-- a reader clicks a store link, with props.browser = "Chrome" / "Firefox". The
-- store opens in a new tab, so the database never sees the click otherwise.

alter table everything_events
  drop constraint everything_events_event_check;

alter table everything_events
  add constraint everything_events_event_check check (event in (
    'pageview',
    'notes_shown',
    'extension_installed',
    'extension_active',
    'sign_in_started',
    'signed_in',
    'vote_gated_login',
    'write_note_teaser_shown',
    'improvement_write_rejected',
    'note_write_rejected',
    'extension_store_clicked'));

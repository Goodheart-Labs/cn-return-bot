-- Note requests moved from text-selection level to page level ("Request
-- notes on this page" in the extension popup) — a request no longer carries
-- a selection, so the column becomes optional.

alter table everything_note_requests alter column selection drop not null;

alter table everything_note_requests drop constraint everything_note_requests_selection_check;
alter table everything_note_requests add constraint everything_note_requests_selection_check
  check (selection is null or char_length(selection) between 1 and 2000);

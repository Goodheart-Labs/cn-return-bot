-- The intent gate (GOO-159) finishes an item without extracting anything when
-- the text does not try to shape the reader's beliefs: an announcement, a
-- personal update, entertainment. Such an item is marked done, so it is never
-- picked up again, and this column keeps the model's reason so the decision
-- can be audited. It is null for every item that was processed.
alter table everything_items add column skip_reason text;

comment on column everything_items.skip_reason is
  'Why the intent gate declined to process this item. Null when it was processed or never gated.';

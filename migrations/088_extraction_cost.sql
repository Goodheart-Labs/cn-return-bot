-- Count claim extraction in the daily spend cap (GOO-88).
--
-- The cap sums everything_pipeline_runs.cost, but until now only claim checks
-- wrote rows there. Extracting the claims is a large-model call per chunk of
-- document and was never recorded, so real spending crossed the cap before the
-- counter said so. Extraction now writes one row per item, and since such a
-- row belongs to an item rather than a claim, claim_id becomes nullable and
-- kind says which of the two a row is.

alter table everything_pipeline_runs alter column claim_id drop not null;

alter table everything_pipeline_runs
  add column kind text not null default 'check' check (kind in ('check', 'extraction'));

alter table everything_pipeline_runs
  add column item_id uuid references everything_items(id) on delete cascade;

create index everything_pipeline_runs_item_id_idx
  on everything_pipeline_runs (item_id)
  where item_id is not null;

comment on column everything_pipeline_runs.kind is
  'check = one fact-check of one claim, the row shape this table always held. extraction = the claim extraction of one item, recorded so the daily spend cap counts it.';

comment on column everything_pipeline_runs.item_id is
  'The item an extraction row belongs to. Null on check rows, which key on claim_id instead.';

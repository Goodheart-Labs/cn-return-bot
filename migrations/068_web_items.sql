-- Write-anywhere: signed-in users can write the FIRST note on any web page.
-- A note needs a claim, a claim needs an everything_items row — so clients
-- may create exactly one kind of item: source 'web' under the fixed
-- catch-all project. `url` is unique, so concurrent creators race safely
-- (loser re-selects the winner's row).

alter table everything_items drop constraint everything_items_source_check;
alter table everything_items add constraint everything_items_source_check
  check (source in ('youtube', 'substack', 'podcast', 'web'));

insert into everything_projects (slug, name, description)
values ('web', 'Around the web', 'Pages readers annotated directly from the browser extension')
on conflict (slug) do nothing;

-- Insert-only for clients (migration 050 revoked the default grants); the
-- policy pins the source so substack/youtube items can never be faked.
grant insert on everything_items to authenticated;
create policy items_insert_web on everything_items
  for insert to authenticated
  with check (source = 'web');

-- The listing at 20 times production's 6,294 posts (GOO-791). Run after
-- migration 184 on its throwaway Postgres (184_notewriter_api.fixture.sql):
--   psql -h 127.0.0.1 -p 55484 -U postgres -f src/scripts_jim/2026_11_19_notewriter_api_v2/bench.sql
-- 126,000 posts over 400 days, so about 4,400 are listed (production lists
-- about 1,300 at 90 new posts a day). 500 creators with scores. Two
-- reservations on a third of the posts, by 5 notewriters, and 200 requested.
\timing off
set client_min_messages = warning;
insert into everything_notewriters (id, name, owner) select 'bench-' || n, 'Bench ' || n, 'test' from generate_series(1, 5) n;
insert into everything_projects (id, name, feed_url, list_rank)
select gen_random_uuid(), 'Creator ' || n, 'https://c' || n || '.example', case when n <= 5 then 1000 + random() * 5 else random() * 10 end
  from generate_series(1, 500) n;
insert into everything_items (project_id, url, full_text, published_at, status, source)
select (select id from everything_projects order by random() limit 1 offset (n % 7)),
       'https://bench.example/' || n, 'Bench post ' || n || ' says something worth checking about the world.',
       current_date - (n % 400), 'done', 'substack'
  from generate_series(1, 126000) n;
update everything_items i set project_id = p.id
  from (select id, row_number() over () as rn from everything_projects) p
 where i.url like 'https://bench.example/%' and p.rn = (abs(hashtext(i.url)) % 500) + 1;
insert into everything_reservations (item_id, notewriter_id, place, requested, started_at, deadline, ended_at, outcome)
select i.id, 'bench-' || (1 + (abs(hashtext(i.url)) % 5)), 1, false, now() - interval '1 day', now(), now(), 'done'
  from everything_items i where i.url like 'https://bench.example/%' and abs(hashtext(i.url)) % 3 = 0;
insert into everything_reservations (item_id, notewriter_id, place, requested, started_at, deadline, ended_at, outcome)
select i.id, 'bench-' || (1 + ((abs(hashtext(i.url)) + 1) % 5)), 2, false, now() - interval '1 day', now(), now(), 'skipped'
  from everything_items i where i.url like 'https://bench.example/%' and abs(hashtext(i.url)) % 6 = 0;
update everything_items set requested_since = now() - interval '1 hour'
 where url like 'https://bench.example/%' and abs(hashtext(url)) % 630 = 1;
analyze everything_items; analyze everything_reservations;
select count(*) as posts, count(*) filter (where list_open) as listed, count(*) filter (where list_requested) as requested from everything_items;

\timing on
\echo first page of 50, team counts
explain (analyze, buffers, costs off) select id from everything_list_page('bench-1', 50, null, 0, true, null, null);
\echo a page deep in the list, after the 2000th listed post, everyone's counts
select (everything_list_key(i, false))::text as after from everything_items i where list_open
 order by (not list_requested), list_all_count, (- list_rank), (date '2000-01-01' - list_date), id offset 2000 limit 1 \gset
explain (analyze, buffers, costs off) select id from everything_list_page('bench-1', 50, (:'after')::jsonb, 2, false, null, null);
\echo requested posts only
explain (analyze, buffers, costs off) select id from everything_list_page('bench-1', 50, null, 0, true, 'requested', null);
\echo the whole API call, first page
select set_config('request.headers', json_build_object('x-notewriter-key', notewriter_admin_new_key('bench-1'))::text, false) \gset
select jsonb_array_length(notewriter_api_posts(50) -> 'posts') as posts_on_page;
select jsonb_array_length(notewriter_api_posts(50, null, 0, 'team') -> 'posts') as posts_on_page;
\echo v1 next_post
update everything_notewriters set every_minutes = 1 where id = 'bench-2';
select notewriter_next_post('bench-2') ->> 'kind' as kind;
\echo a reservation, which recounts its post
select notewriter_api_reserve((select id from everything_list_page('bench-1', 1, null, 0, true, null, null))) ->> 'kind' as kind;
\echo the tidy-up of cn-walk
select * from notewriter_tidy_list();

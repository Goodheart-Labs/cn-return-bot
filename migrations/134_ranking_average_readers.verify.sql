-- Checks migration 134 against its fixture (GOO-549).

-- The function computes the average over every visited creator and returns it.
do $$
declare average float8;
begin
  select distinct average_readers_per_post into average from everything_creator_ranking(10, 1.0, 2, 2, 3);
  if abs(average - 272.0 / 231) > 1e-9 then
    raise exception 'expected the average 272 / 231, got %', average;
  end if;
end $$;

-- With that average, steady scores (13 + 3 * 1.178) / 15 = 1.10 and is
-- walked, and lowish scores (11 + 3 * 1.178) / 15 = 0.97 and is not. The
-- typical creators score 0.90.
do $$
declare walked text[];
begin
  select array_agg(feed_url order by feed_url) into walked from everything_creator_ranking(10, 1.0, 2, 2, 3);
  if walked is distinct from array['https://steady.substack.com', 'https://thezvi.substack.com'] then
    raise exception 'expected steady and thezvi to be walked, got %', walked;
  end if;
end $$;

set role anon;
select count(*) from everything_creator_ranking(10, 1.0, 2, 2, 3);
reset role;

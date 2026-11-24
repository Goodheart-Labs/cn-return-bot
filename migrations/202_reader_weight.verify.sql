-- Checks for migration 202. Run it after the migration. It changes nothing.
-- Every value should be true.
select everything_reader_weight() = 0.7 as weight_is_0_7,
       not exists (select 1 from everything_items i left join everything_projects p on p.id = i.project_id
                    where i.list_open and i.list_rank <> coalesce(p.list_rank, 0) + 0.7 * i.list_readers) as rank_is_creator_plus_weighed_readers;

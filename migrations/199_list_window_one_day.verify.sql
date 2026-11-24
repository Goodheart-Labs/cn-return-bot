-- Checks for migration 199. Run it after the migration and one
-- notewriter_tidy_list. It changes nothing. Every value should be true.
select everything_list_days() = 1 as window_is_one_day,
       not exists (select 1 from everything_items
                    where list_open and not list_requested and list_date < current_date - 1) as no_older_post_listed;

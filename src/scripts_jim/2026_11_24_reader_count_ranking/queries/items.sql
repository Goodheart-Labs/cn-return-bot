-- Every post that could have been on the list between 2026-11-14 and now.
select i.id, everything_visit_page(i.url) as page, i.source, i.status,
       lower(rtrim(p.feed_url, '/')) as creator, p.slug as project,
       i.published_at, i.published_time, i.created_at, i.demanded_at, i.requested_since,
       i.first_checked_at, i.flagged_at is not null as flagged,
       i.full_text is not null as has_text, i.caption_cues is not null as has_cues,
       i.list_rank, i.list_open
  from everything_items i left join everything_projects p on p.id = i.project_id
 where coalesce(i.demanded_at::date, i.published_at, i.created_at::date) >= date '2026-10-31'
    or i.created_at >= '2026-10-31'
    or i.id in (select item_id from everything_reservations where started_at >= '2026-11-14');

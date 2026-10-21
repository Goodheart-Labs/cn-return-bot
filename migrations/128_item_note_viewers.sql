-- 128: how many people saw the notes on each post (GOO-484).
--
-- The website's All notes page lets a reader filter notes by views. A view is
-- counted per post, not per note, because no event records which single note a
-- reader looked at. The extension writes a notes_shown event each time it
-- actually displays a post's notes, and the event carries the post's item id.
-- So the views of a post are the different devices that sent such an event.
--
-- Our own browsers would inflate these counts, so two kinds of device are left
-- out. A development install is an unpacked build, which only the team runs
-- (migration 116 drops these from the dashboard the same way). A team device is
-- one that sent any event while signed in with an admin's email, which catches
-- Jim's and Nathan's normal installs too.
--
-- props is written by the client, so the item id is returned as text and never
-- cast. A malformed id simply matches no post on the page.
--
-- The anon key can never read raw events, so this function runs with its
-- owner's rights and returns only a count per post.

create function everything_item_note_viewers()
returns table (item_id text, viewers bigint)
language sql
stable
security definer
set search_path = public
as $$
  with team_devices as (
    select distinct e.device_id
    from everything_events e
    join auth.users u on u.id = e.user_id
    join everything_admins a on a.email = lower(u.email)
  )
  select e.props ->> 'item_id', count(distinct e.device_id)
  from everything_events e
  where e.event = 'notes_shown'
    and e.props ->> 'item_id' is not null
    and e.props ->> 'install_type' is distinct from 'development'
    and not exists (select 1 from team_devices t where t.device_id = e.device_id)
  group by 1;
$$;

revoke execute on function everything_item_note_viewers() from public;
grant execute on function everything_item_note_viewers() to anon, authenticated, service_role;

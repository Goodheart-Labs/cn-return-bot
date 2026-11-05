-- GOO-721: six YouTube videos were closed as "no captions" before their
-- 24 hours of caption retries were over, because the age was measured from
-- the upload day. This makes each row look to the walk like a post it has
-- never queued: a row without a whole-page scope counts as unchecked, and the
-- walk promotes it to a fresh whole-page check when it next picks the post.
update everything_items
set checked_scope = null,
    skip_reason = null,
    retries = 0,
    error = null,
    progress = null,
    processed_at = null,
    started_at = null,
    first_checked_at = null
where id in (
  '5eaf5363-6218-45cf-b2db-67bcc90eec28',
  '6281dbb1-dffc-46b6-9d62-f54cc42abda1',
  '490c9891-e6b3-4c5d-804e-a33cc1f111dd',
  '042cd1f9-a455-41b5-856e-5c7e0ac95723',
  '2aecfa54-bb52-4a44-8e0d-085365858e07',
  'ffde46a8-aaeb-4d8f-8cf1-bdcd08653df0'
)
  and status = 'done' and skip_reason = 'no captions'
returning id, left(title, 35) as title, status, checked_scope, retries;

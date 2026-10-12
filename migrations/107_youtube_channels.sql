-- 107: what the walk knows about each YouTube channel, so it stops spending
-- the Data API quota on channels that have nothing new (GOO-225).
--
-- Until now every feed run asked the YouTube Data API for the newest uploads of
-- every YouTube creator it passed, at three quota units each. With about 420
-- ranked creators and 160 runs a day, the 10,000 daily units were gone by the
-- afternoon, and no YouTube channel could be listed until the next reset.
--
-- Now each channel we walk is subscribed to YouTube's push notifications.
-- WebSub is a web standard (formerly called PubSubHubbub) that YouTube uses to
-- announce new uploads. We ask Google's hub to tell us when a channel
-- publishes, and the hub then calls our Edge Function youtube-websub, which
-- stamps notified_at on the channel's row. The walk asks the Data API for a
-- channel's uploads only when that stamp is newer than the last listing, or
-- when the last listing is a day old. The daily listing catches a notification
-- the hub failed to send. Between listings the walk reads the stored uploads.
--
-- One row per YouTube feed the walk has reached. The feed URL is the key the
-- ranking uses. Two feed URLs can name the same channel, one by its @handle and
-- one by its /channel/UC… id, so channel_id is indexed but not unique, and a
-- notification stamps every row with that id.

create table everything_youtube_channels (
  feed_url text primary key,
  channel_id text not null,
  title text not null,
  uploads jsonb not null default '[]'::jsonb,
  listed_at timestamptz,
  notified_at timestamptz,
  subscribed_at timestamptz
);

create index everything_youtube_channels_channel_id on everything_youtube_channels (channel_id);

comment on table everything_youtube_channels is
  'Every YouTube feed the creator walk has reached: its channel id, its last Data API listing, and its WebSub notification state (GOO-225). Service key only.';
comment on column everything_youtube_channels.feed_url is
  'The creator''s canonical feed URL, the same form the creator ranking and everything_top_posts use.';
comment on column everything_youtube_channels.channel_id is
  'YouTube''s permanent channel id (UC…). Looked up once from the feed URL, so a listing no longer pays a quota unit for it.';
comment on column everything_youtube_channels.title is
  'The channel''s name, used as the project''s display name when its first post is enqueued.';
comment on column everything_youtube_channels.uploads is
  'The newest long-form uploads from the last listing, newest first: [{videoId, title, publishedAt, upcoming}].';
comment on column everything_youtube_channels.listed_at is
  'When uploads was last fetched from the Data API. Null until the first listing.';
comment on column everything_youtube_channels.notified_at is
  'When Google''s WebSub hub last told us this channel published or changed a video. Set by the youtube-websub Edge Function.';
comment on column everything_youtube_channels.subscribed_at is
  'When the walk last asked the hub to subscribe us to this channel. A subscription lapses after a few days, so the walk renews it.';

-- No policies: only the service key, which bypasses row level security, can
-- read or write the table. The Edge Function uses the service key too.
alter table everything_youtube_channels enable row level security;

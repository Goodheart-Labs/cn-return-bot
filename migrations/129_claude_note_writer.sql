-- 129: Claude Code writes Common Notes instead of the pipeline (GOO-507).
--
-- A permanent Claude Code session on the devbox researches posts with
-- subagents and posts the notes itself. Jim and Nathan review those notes
-- afterwards in the note review dashboard, which reads these tables with the
-- service key. The anon key reaches none of them.

-- One row that says who writes notes and whether notes wait for approval.
-- writer = 'pipeline' is the old behaviour. With writer = 'claude' the feed
-- run and the intake service leave queued items alone, except the ones Claude
-- handed back. approval_required keeps Claude's notes unposted until Jim or
-- Nathan approves them in the dashboard.
create table everything_claude_settings (
  id boolean primary key default true check (id),
  writer text not null default 'pipeline' check (writer in ('pipeline', 'claude')),
  approval_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);
insert into everything_claude_settings default values;

-- One row per passage a note-finding agent looked at. A draft with outcome
-- 'note' is a note. It is posted at once, or waits for approval while
-- approval_required is on. Rejecting a posted note deletes it from
-- everything_notes, and rewriting it posts the new text and deletes the old
-- note, so note_id always points at the live note, if there is one.
create table everything_claude_drafts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items (id) on delete cascade,
  passage text not null,
  claim text not null,
  kind text not null check (kind in ('small_mistake', 'missing_context', 'wrong_or_misleading')),
  outcome text not null check (outcome in ('note', 'no_note_needed', 'too_hard', 'withdrawn')),
  note text not null default '',
  reasoning text not null,
  -- [{ url, quote, explanation }], the note's supporting quotes.
  sources jsonb not null default '[]',
  status text not null check (status in ('awaiting_approval', 'posted', 'rejected', 'not_a_note')),
  note_id uuid references everything_notes (id) on delete set null,
  -- Who the live note is posted as: 'ai' means no account, like pipeline notes.
  posted_as text check (posted_as in ('ai', 'jim', 'nathan')),
  -- Who approved or rejected the note in the dashboard, and when.
  reviewed_by text check (reviewed_by in ('jim', 'nathan')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index everything_claude_drafts_item on everything_claude_drafts (item_id);

-- Every step anyone took, oldest first and never changed: a draft written, a
-- note posted, approved, rejected, rewritten or withdrawn, a chat message and
-- its answer, a pipeline note Claude kept or deleted, an item Claude took or
-- handed back, a settings change. note_id has no foreign key because the log
-- outlives deleted notes.
create table everything_claude_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null check (actor in ('jim', 'nathan', 'claude')),
  type text not null,
  draft_id uuid references everything_claude_drafts (id) on delete set null,
  item_id uuid references everything_items (id) on delete set null,
  note_id uuid,
  data jsonb not null default '{}'
);
create index everything_claude_events_draft on everything_claude_events (draft_id);
create index everything_claude_events_type_at on everything_claude_events (type, at);

-- Items Claude gave back to the pipeline, for example when its usage budget
-- ran low. While writer = 'claude', the workers take only these.
create table everything_claude_handbacks (
  item_id uuid primary key references everything_items (id) on delete cascade,
  at timestamptz not null default now(),
  reason text not null
);

alter table everything_claude_settings enable row level security;
alter table everything_claude_drafts enable row level security;
alter table everything_claude_events enable row level security;
alter table everything_claude_handbacks enable row level security;

-- Only the service key reads and writes these tables. Row level security with
-- no policies already shuts out anon and authenticated, and the grants say the
-- same thing out loud.
revoke all on everything_claude_settings, everything_claude_drafts, everything_claude_events, everything_claude_handbacks from anon, authenticated;
grant all on everything_claude_settings, everything_claude_drafts, everything_claude_events, everything_claude_handbacks to service_role;

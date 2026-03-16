-- Core tables: notewriters, bot_configs, notes
-- These were originally created via the Supabase dashboard before migrations were tracked.
-- Reconstructed from TypeScript interfaces in src/api/supabaseClient.ts.

-- 1. Notewriter accounts
CREATE TABLE IF NOT EXISTS notewriters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT,
  credentials_ref TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Bot configurations
CREATE TABLE IF NOT EXISTS bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  config JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Submitted notes
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  notewriter_id TEXT,
  bot_config_id TEXT,
  bot_name TEXT,
  note_text TEXT NOT NULL,
  source_url TEXT,
  evaluation_score DOUBLE PRECISION,
  commit_sha TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cn_status TEXT,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  somewhat_helpful_count INTEGER NOT NULL DEFAULT 0,
  not_helpful_count INTEGER NOT NULL DEFAULT 0,
  first_helpful_at TIMESTAMPTZ,
  view_count INTEGER,
  views_last_updated_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ
);

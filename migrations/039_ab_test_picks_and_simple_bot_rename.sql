-- Rename claude-simple → simple-bot, replace bot_name_long with ab_test_picks.
--
-- bot_name_long encoded both the bot family and the variant in one ad-hoc
-- string ("claude-simple_claude-simple-sonnet-gemini"). Replacing it with a
-- JSONB dictionary lets us track multiple A/B test dimensions independently.
--
-- New shape: ab_test_picks like { bot, simple_bot_search, simple_bot_writer,
-- agent_search, agent_parallel } — one key per A/B test that fired for the run.
--
-- Backfill rules:
--   claude-simple_claude-simple-sonnet-sonnet
--     → { bot:simple-bot, simple_bot_search:sonnet46-native, simple_bot_writer:sonnet }
--   claude-simple_claude-simple-sonnet-gemini
--     → { bot:simple-bot, simple_bot_search:sonnet46-native, simple_bot_writer:gemini-flash }
--   <bot>_gemini-flash-perplexity[-parallel]      → { bot, agent_search:perplexity, agent_parallel:seq|par }
--   <bot>_gemini-flash-searxng[-parallel]         → { bot, agent_search:searxng,    agent_parallel:seq|par }
--   <bot>_gemini-flash-searxng-summarized[-parallel] → { bot, agent_search:searxngsum, agent_parallel:seq|par }
--   (Same prefix for both "agent" and "multi-agent".)
--   Anything else (opus-main, opus-main-v2, ...) → { bot: <bot_name> }
--
-- Verifier was always gemini-flash for the two pre-rename simple-bot rows; new
-- rows still verify with gemini-flash via DEFAULT_CONFIG, so simple_bot_verifier
-- has no entry in either historical or new picks (matches the live framework).

BEGIN;

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS ab_test_picks JSONB;

-- 1. Rename the simple-bot family.
UPDATE pipeline_runs SET bot_name = 'simple-bot' WHERE bot_name = 'claude-simple';

-- 2. Backfill the two known simple-bot variants.
UPDATE pipeline_runs
   SET ab_test_picks = jsonb_build_object(
     'bot', 'simple-bot',
     'simple_bot_search', 'sonnet46-native',
     'simple_bot_writer', 'sonnet'
   )
 WHERE bot_name = 'simple-bot'
   AND bot_name_long = 'claude-simple_claude-simple-sonnet-sonnet';

UPDATE pipeline_runs
   SET ab_test_picks = jsonb_build_object(
     'bot', 'simple-bot',
     'simple_bot_search', 'sonnet46-native',
     'simple_bot_writer', 'gemini-flash'
   )
 WHERE bot_name = 'simple-bot'
   AND bot_name_long = 'claude-simple_claude-simple-sonnet-gemini';

-- 3. Backfill agent + multi-agent variants from their bot_name_long encoding.
DO $$
DECLARE
  bot text;
  pair text[];
  pairs text[][] := ARRAY[
    ARRAY['gemini-flash-perplexity',                  'perplexity', 'seq'],
    ARRAY['gemini-flash-perplexity-parallel',         'perplexity', 'par'],
    ARRAY['gemini-flash-searxng',                     'searxng',    'seq'],
    ARRAY['gemini-flash-searxng-parallel',            'searxng',    'par'],
    ARRAY['gemini-flash-searxng-summarized',          'searxngsum', 'seq'],
    ARRAY['gemini-flash-searxng-summarized-parallel', 'searxngsum', 'par']
  ];
BEGIN
  FOREACH bot IN ARRAY ARRAY['agent', 'multi-agent'] LOOP
    FOREACH pair SLICE 1 IN ARRAY pairs LOOP
      UPDATE pipeline_runs
         SET ab_test_picks = jsonb_build_object(
           'bot',            bot,
           'agent_search',   pair[2],
           'agent_parallel', pair[3]
         )
       WHERE bot_name = bot AND bot_name_long = bot || '_' || pair[1];
    END LOOP;
  END LOOP;
END$$;

-- 4. Generic backfill for everything else (opus-main, opus-main-v2, ...) where
--    bot_name_long was just the bot name. Picks just record the bot.
UPDATE pipeline_runs
   SET ab_test_picks = jsonb_build_object('bot', bot_name)
 WHERE ab_test_picks IS NULL AND bot_name IS NOT NULL;

-- 5. Sanity assertions.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pipeline_runs WHERE ab_test_picks IS NULL AND bot_name IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Migration 039: % rows with bot_name but no ab_test_picks', n; END IF;

  SELECT count(*) INTO n FROM pipeline_runs WHERE bot_name = 'claude-simple';
  IF n > 0 THEN RAISE EXCEPTION 'Migration 039: % unrenamed claude-simple rows', n; END IF;
END$$;

-- 6. Drop the old column + index, add a GIN index on the new column.
DROP INDEX IF EXISTS idx_pipeline_runs_bot_name_long;
ALTER TABLE pipeline_runs DROP COLUMN bot_name_long;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_ab_test_picks
  ON pipeline_runs USING GIN (ab_test_picks);

COMMIT;

-- Improvements are now posted as ordinary draft notes on the same claim (shown
-- alongside the original, rated like any note) instead of an LLM-judged rewrite
-- that replaced the note text. That retires the whole suggestion machinery: the
-- everything_note_suggestions table and the judge-suggestion edge function.

drop table if exists everything_note_suggestions;

-- 154: the pipeline is no longer the Claude note writer's fallback (GOO-618).
-- Nothing hands items to it any more, so the hand-backs table goes. Apply this
-- once the services machine and the runner on Nathan's ai-box run the code of
-- the PR, because the old code still reads the table.

drop table everything_claude_handbacks;

notify pgrst, 'reload schema';

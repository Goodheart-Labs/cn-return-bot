# Why Nov 2 had 30 Common Notes and Oct 30 had 406 (GOO-696)

All notes on both days are the Claude note writer's. Reader-written notes are a handful per week.

## Scripts

Run from the worktree root with `bun run src/scripts_jim/2026_11_03_notes_volume_drop/<script>.ts`.

- `notesPerDay.ts`: Common Notes and X notes per UTC day since Sep 15.
- `notesByDayDetail.ts`: each day's notes by author and by post, with the posts that got the most notes.
- `draftOutcomes.ts`: Claude's drafts per day by outcome, and notes per post.
- `usageTimeline.ts`: per 6 hours, the plan's weekly usage, Claude runs by tag and Claude events by type.
- `replayPacing.ts`: replays `computeClaudePacing` every 3 hours with the real readings, and prints the raw readings around the Nov 1 reset.
- `takenGaps.ts`: posts Claude took per day, split into reader requests and feed posts, with the median gap.

## Findings (numbers per UTC day)

| Day | Posts taken | Notes | Notes per post | Posts per day the pacing allowed |
| --- | --- | --- | --- | --- |
| Oct 25 to 28 | 43 to 78 | 28 to 63 | about 1.25 | about 110 to 130 |
| Oct 29 | 165 | 152 | 1.28 | about 110 |
| Oct 30 | 180 | 406 | 2.78 | about 70 to 110 |
| Oct 31 | 24 | 98 | 4.0 | about 70, then 11 near 80% |
| Nov 1 | 91 | 161 | 2.3 | over 1,000 until 11:00, then about 65 |
| Nov 2 | 38 | 30 | 1.0 | about 50 |

1. Oct 30 is the outlier, not Nov 2. Nathan's plan was at 47% of its week at midnight with 2.5 days left, so the usage pacing spaced feed posts a few minutes apart. The walk ran out of new posts and filled the queue with creators' old popular posts. Many were long, such as three-hour podcasts, and got almost three notes each.
2. Nathan's Claude account has been on hold since Oct 31 22:17 UTC (GOO-681). Every Claude the ai-box runner started answered "Your account is on hold". The runner was stopped on Nov 1 05:47.
3. Since then the devbox session runs the jobs on Jim's plan (PR #668). The usage readings are now Jim's plan, whose weekly rise includes all of Jim's other Claude sessions. So a post looks more expensive (0.11% of the week per post on Oct 30, 0.17% on Nov 2, and rising), and the pacing allows about 50 posts a day instead of about 110.
4. On Nov 2 Claude also wrote fewer notes per post: 1.0 against about 1.25 the week before.

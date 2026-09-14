# Continuous pacing: replaying the last week under the gate

`replayPacing.ts` is read-only against production. It rebuilds each feed post's real start, duration and cost from `everything_pipeline_runs`, then replays every UTC day of the window with the gate from `src/everything/pacing.ts`: a dispatch every 30 minutes at :03 and :33, one post per opening, a wait in place when the gate opens within 25 minutes, the reader-requested spend added at its real time, and posts that did not start by midnight carried into the next day.

```
bun run src/scripts_jim/2026_09_14_continuous_pacing/replayPacing.ts [days]
```

## Output on 2026-09-14, the 7 days before

Each pair of rows is one UTC day: the real spend per hour above, the replayed spend below. The reader-requested spend (the 50.8 USD page on Sep 11 at noon) is in both rows.

```
replaying 7 days · 98 feed posts, 3 reader posts · feed budget $45 · default mean $3.5

hours           0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
09-07 real    2.6  9.0  3.9  1.1  2.3 21.1 10.6 13.9    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  64.43
09-07 paced   2.5  0.1  7.6    ·  1.4    ·  0.8  3.0  0.4  0.4  0.3  1.5  0.9 21.1    ·    ·    ·  4.8    ·    ·    ·    ·    ·    ·  =  44.70
         13 started, 9 after a wait in place, 33 ticks left to a later dispatch, 6 carried over

09-08 real      · 12.9  8.3  3.4 11.9 11.3    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  47.81
09-08 paced   4.4    ·  1.4  0.1    ·  1.3  0.1    · 12.5    ·    ·  4.8    ·  8.2    ·  7.4    ·    ·    ·  0.9    ·  2.1    ·    ·  =  43.07
         11 started, 6 after a wait in place, 32 ticks left to a later dispatch, 4 carried over

09-09 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.1  8.7  1.2  2.3  5.8 14.6 20.0    ·    ·  =  56.88
09-09 paced   1.2  1.5    · 10.4    · 11.3    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.0  0.0  0.0  0.0  0.1  0.0  5.3  3.4  2.2  =  39.72
         14 started, 8 after a wait in place, 15 ticks left to a later dispatch, 5 carried over

09-10 real   10.1 21.0 11.9    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  42.92
09-10 paced     ·  1.3  1.3    ·  4.5 14.6    ·    · 20.0    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  41.63
         5 started, 5 after a wait in place, 36 ticks left to a later dispatch, 5 carried over

09-11 real   19.3  0.0  0.0  0.0 11.5  0.5  2.6    ·  3.8    ·  3.5    · 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  92.13
09-11 paced  10.1    · 21.0    ·    ·    ·    ·    ·  0.0    ·    ·    · 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  81.88
         3 started, 2 after a wait in place, 43 ticks left to a later dispatch, 17 carried over

09-12 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  3.5  2.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =   6.23
09-12 paced   1.0    ·    ·    · 10.8    ·    ·    ·    · 19.3    ·    ·    ·    ·    ·  0.0    ·    ·    ·  0.0    ·  0.0  0.0 11.5  =  42.70
         10 started, 5 after a wait in place, 31 ticks left to a later dispatch, 11 carried over

09-13 real    0.0  0.1    ·    ·    ·  5.0  4.3  1.6    ·    ·  0.0  0.6    ·    ·    ·    ·    ·  0.0  0.8  5.9  8.0    ·    ·    ·  =  26.38
09-13 paced     ·    ·  0.0    ·  0.5  1.6  1.0    ·  3.8  1.0  2.5  0.0  3.4  0.1  2.8    ·    ·  0.0  0.1  5.0  5.9  0.0  0.6  0.8  =  29.19
         23 started, 10 after a wait in place, 19 ticks left to a later dispatch, 4 carried over

```

## What it shows

- The real rows put almost all money in the hours right after midnight UTC (Sep 07, 08, 10, 11) or in one evening burst (Sep 09). The paced rows spread the same posts over the day: Sep 13 starts 23 posts between 04:00 and 23:00.
- On Sep 11 the gate started three posts, then the 50.8 USD reader page at noon used up the feed budget and the gate stayed closed for the day. That is the existing budget rule, not pacing: reader spend counts against the day, and pacing does not protect the feed from it.
- The real week spent more than the 45 USD feed budget on four days. Pacing cannot spend what the cap forbids, so some posts carry over to the next day and the replayed week starts fewer posts than really ran. That is expected; the point of GOO-159 is to make posts cheap enough that the budget covers the walk.

## Caveats of the replay

- A post's cost lands in the hour it starts. In reality it is spread over the post's duration.
- A post resumed across days has a real span of days; the replay caps its duration at 3 hours and treats it as one run.
- A post that would have crossed the cap is charged only what was left; in reality the per-claim stop cuts it and it resumes another day.
- Only posts that really started by a tick are candidates, so the replay never starts a post before it was published. It also cannot start posts the real walk never chose.

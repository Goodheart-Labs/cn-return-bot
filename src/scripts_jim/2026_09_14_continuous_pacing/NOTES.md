# Continuous pacing: replaying the last week under the alarm

`replayPacing.ts` is read-only against production. It rebuilds each feed post's real start, duration and cost from `everything_pipeline_runs`, then replays every UTC day of the window the way `src/everything/pacing.ts` and migration 097 run it: a run starts at the first minute tick after the alarm the previous run set, plus the minute and a half a fresh run takes to start; it processes one post, then sets the next alarm from the money left, the hours left and the mean post cost at that moment; a run that finds nothing waiting sets the idle alarm 30 minutes out. The reader-requested spend is added at its real time, and posts that did not start by midnight carry into the next day.

```
bun run src/scripts_jim/2026_09_14_continuous_pacing/replayPacing.ts [days]
```

## Output on 2026-09-15, the 7 days before

Each pair of rows is one UTC day: the real spend per hour above, the replayed spend below. The reader-requested spend (the 50.8 USD page on Sep 11 at noon) is in both rows.

```
replaying 7 days · 79 feed posts, 3 reader posts · feed budget $45 · default mean $3.5

hours           0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
09-08 real      · 12.9  8.3  3.4 11.9 11.3    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  47.81
09-08 paced     ·  4.8    ·    ·  8.2    ·    ·    ·  7.4    ·    ·    ·  0.9    ·    ·  2.1    ·  1.2  1.5 10.4    ·  8.5    ·    ·  =  45.00
         9 started, 1 of them outlasted their interval, 3 idle runs, 0 runs stopped by the cap, 0 carried over

09-09 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.1  8.7  1.2  2.3  5.8 14.6 20.0    ·    ·  =  56.88
09-09 paced     ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.0  0.0  0.1  5.3  3.4  3.5 20.4  8.1    ·  =  45.00
         15 started, 1 of them outlasted their interval, 27 idle runs, 0 runs stopped by the cap, 0 carried over

09-10 real   10.1 21.0 11.9    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  42.92
09-10 paced     · 10.1    ·    · 21.0    ·    ·    ·    ·    ·  0.0    ·    ·    ·  1.0    ·    · 10.8    ·    ·    ·    ·    ·    ·  =  42.92
         5 started, 0 of them outlasted their interval, 0 idle runs, 0 runs stopped by the cap, 0 carried over

09-11 real   19.3  0.0  0.0  0.0 11.5  0.5  2.6    ·  3.8    ·  3.5    · 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  92.13
09-11 paced  19.3    ·    ·    ·  0.0    ·    ·    ·  0.0    ·    ·  0.0 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  70.12
         4 started, 0 of them outlasted their interval, 1 idle runs, 1 runs stopped by the cap, 11 carried over

09-12 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  3.5  2.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =   6.23
09-12 paced   0.0    ·    ·  0.0    ·  1.1    · 10.4    ·  0.0  0.5    ·  1.6  1.0  3.8  1.0    ·  2.5  3.4  0.1  2.8    ·    ·    ·  =  28.25
         15 started, 1 of them outlasted their interval, 2 idle runs, 0 runs stopped by the cap, 0 carried over

09-13 real    0.0  0.1    ·    ·    ·  5.0  4.3  1.6    ·    ·  0.0  0.6    ·    ·    ·    ·    ·  0.0  0.8  5.9  8.0    ·    ·    ·  =  26.38
09-13 paced   0.0  0.0  0.1    ·    ·  5.0  4.3  1.6  0.0    ·  0.0  0.6    ·    ·    ·    ·    ·  0.0    ·  6.7    ·  8.0    ·    ·  =  26.38
         16 started, 1 of them outlasted their interval, 26 idle runs, 0 runs stopped by the cap, 0 carried over

09-14 real    2.9    ·    ·    ·    ·    ·    ·    ·    ·    ·  0.0  0.0    ·  1.2  0.7  1.2    ·    ·  1.4    ·    ·    ·    ·    ·  =   7.38
09-14 paced     ·  0.0  0.8  0.0  2.1    ·    ·    ·    ·    ·  0.0  0.0    ·  1.2  0.4  0.4  1.1    ·  0.3  1.1    ·    ·    ·    ·  =   7.38
         15 started, 1 of them outlasted their interval, 31 idle runs, 0 runs stopped by the cap, 0 carried over
```

## What it shows

- The real rows put almost all money in the hours right after midnight UTC (Sep 08, 10, 11) or in one evening burst (Sep 09). The paced rows spread the same posts over the day: Sep 12 starts 15 posts between 00:00 and 21:00, Sep 09 fills the evening from the moment its first post existed.
- When a day closes with its budget spent, the next alarm is midnight, and the first post of the new day starts at 00:01. That is the 19.3 USD post at hour 0 on Sep 11 in both rows. It is one post, not a burst: the alarm after it was three and a half hours out.
- On Sep 11 the alarm started four posts, then the 50.8 USD reader page at noon used up the feed budget and the next run stopped at the cap. That is the existing budget rule, not pacing: reader spend counts against the day, and pacing does not protect the feed from it.
- Days that were cheap in reality (Sep 13, Sep 14) come out the same under pacing, spread a little wider. With more money than posts, the rule never holds anything back for long; the idle runs are the pipeline looking for new posts every 30 minutes and finding none.
- A post outlasts its interval about once a day, and the next run then starts at once. The line "n of them outlasted their interval" counts those.

## Caveats of the replay

- A post's cost lands in the hour it starts. In reality it is spread over the post's duration.
- A post resumed across days has a real span of days; the replay caps its duration at 3 hours and treats it as one run.
- A post that would have crossed the cap is charged only what was left; in reality the per-claim stop cuts it and it resumes another day.
- Only posts that really started by a run are candidates, so the replay never starts a post before it was published. It also cannot start posts the real walk never chose, which is why the replayed days never spend more than the real ones did.
- The backstop (a second run 45 minutes after a dispatch whose run set no alarm) is not replayed; it only matters for crashes.

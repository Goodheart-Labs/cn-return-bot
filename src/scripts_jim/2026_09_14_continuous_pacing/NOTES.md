# Continuous pacing: replaying the last week under the alarm

`replayPacing.ts` is read-only against production. It rebuilds each feed post's real start, duration and cost from `everything_pipeline_runs`, then replays every UTC day of the window the way `src/everything/pacing.ts` and migration 098 run it: a run starts at the first minute tick after the alarm the previous run set, plus the minute and a half a fresh run takes to start; it processes one post, then sets the next alarm from the money left, the hours left and the mean post cost at that moment; a run that finds nothing waiting sets the idle alarm 30 minutes out. The mean post cost the rule sees is over the feed posts finished earlier the same UTC day, with the default until the first one. The reader-requested spend is added at its real time, and posts that did not start by midnight carry into the next day.

```
bun run src/scripts_jim/2026_09_14_continuous_pacing/replayPacing.ts [days]
```

## Output on 2026-09-15, the 7 days before (mean over the posts finished the same day)

Each pair of rows is one UTC day: the real spend per hour above, the replayed spend below. The reader-requested spend (the 50.8 USD page on Sep 11 at noon) is in both rows.

```
replaying 7 days · 80 feed posts, 3 reader posts · feed budget $45 · default mean $1

hours           0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
09-08 real    9.3 12.9  8.3  3.4 11.9 11.3    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  57.08
09-08 paced   9.3    ·    ·    ·    ·    ·  4.8    ·    ·    ·  8.2    ·    ·    ·  7.4    ·    ·    ·    ·  0.9    ·  2.1  1.2 11.2  =  45.00
         9 started, 0 of them outlasted their interval, 1 idle runs, 0 runs stopped by the cap, 1 carried over

09-09 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.1  8.7  1.2  2.3  5.8 14.6 20.0    ·    ·  =  56.88
09-09 paced  11.3    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  4.3    ·  0.0  0.0  0.0  0.1  5.3  4.6  3.6 15.8    ·  =  45.00
         15 started, 0 of them outlasted their interval, 16 idle runs, 0 runs stopped by the cap, 1 carried over

09-10 real   10.1 21.0 11.9    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  42.92
09-10 paced  20.0    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    · 10.1    ·    ·    ·    ·    ·    ·    ·  =  30.05
         2 started, 0 of them outlasted their interval, 0 idle runs, 0 runs stopped by the cap, 4 carried over

09-11 real   19.3  0.0  0.0  0.0 11.5  0.5  2.6    ·  3.8    ·  3.5    · 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  92.13
09-11 paced  21.0    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    · 50.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =  71.73
         1 started, 0 of them outlasted their interval, 0 idle runs, 1 runs stopped by the cap, 18 carried over

09-12 real      ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  3.5  2.8    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  =   6.23
09-12 paced  11.9    ·    · 19.3    ·    ·    ·    ·    ·    ·    ·    ·    ·    ·  0.0    ·    ·    ·  0.0    ·  0.0  0.0  1.1 10.4  =  42.75
         11 started, 1 of them outlasted their interval, 0 idle runs, 0 runs stopped by the cap, 11 carried over

09-13 real    0.0  0.1    ·    ·    ·  5.0  4.3  1.6    ·    ·  0.0  0.6    ·    ·    ·    ·    ·  0.0  0.8  5.9  8.0    ·    ·    ·  =  26.38
09-13 paced   3.1  3.8  3.5  0.0  3.4  0.1  2.8    ·    ·  0.0  0.1  3.1  6.2  1.6  0.0  0.0  0.6    ·  0.0  6.5  0.2  8.0    ·    ·  =  43.09
         27 started, 3 of them outlasted their interval, 6 idle runs, 0 runs stopped by the cap, 0 carried over

09-14 real    2.9    ·    ·    ·    ·    ·    ·    ·    ·    ·  0.0  0.0    ·  1.2  0.7  1.2    ·    ·  1.4    ·    ·    ·    ·    ·  =   7.38
09-14 paced   0.8  2.1    ·    ·    ·    ·    ·    ·    ·    ·    ·  0.1    ·    ·  1.9  1.2    ·    ·  0.3  1.1    ·    ·    ·    ·  =   7.38
         15 started, 3 of them outlasted their interval, 40 idle runs, 0 runs stopped by the cap, 0 carried over
```

## What it shows

- The real rows put almost all money in the hours right after midnight UTC (Sep 08, 10, 11) or in one evening burst (Sep 09). The paced rows spread the same posts over the day: Sep 13 starts 27 posts across the whole day, Sep 09 fills the evening from the moment its first post existed.
- When a day closes with its budget spent, the next alarm is midnight, and the first post of the new day starts at 00:01. It is one post, not a burst.
- The mean is over the posts finished the same day, so the first post of a day sets the pace until the second one corrects it. On the expensive days of this week that shows: on Sep 10 a 20 USD first post made the rule expect 20 USD posts, it waited most of the day, and only two posts ran. With the cheap pipeline that merged on Sep 15 posts cost a fraction of that and are far more alike, which is why Jim chose to ignore yesterday's prices.
- On Sep 11 the 50.8 USD reader page at noon used up the feed budget and the next run stopped at the cap. That is the existing budget rule, not pacing: reader spend counts against the day, and pacing does not protect the feed from it.
- Days that were cheap in reality (Sep 14) come out the same under pacing, spread a little wider. With more money than posts, the rule never holds anything back for long; the idle runs are the pipeline looking for new posts every 30 minutes and finding none.
- A post outlasts its interval a few times a day on a busy day, and the next run then starts at once. The line "n of them outlasted their interval" counts those.

## Caveats of the replay

- A post's cost lands in the hour it starts. In reality it is spread over the post's duration.
- A post resumed across days has a real span of days; the replay caps its duration at 3 hours and treats it as one run.
- A post that would have crossed the cap is charged only what was left; in reality the per-claim stop cuts it and it resumes another day.
- Only posts that really started by a run are candidates, so the replay never starts a post before it was published. It also cannot start posts the real walk never chose, which is why the replayed days never spend more than the real ones did.
- The backstop (a second run 45 minutes after a dispatch whose run set no alarm) is not replayed; it only matters for crashes.

# Candidate Ranking System

## Problem
We submit notes first-come-first-served. With a cap of 5/day, we're wasting slots on mediocre notes while better candidates never get a chance. We also burn LLM credits re-processing tweets that already have notes.

## Solution
Split the pipeline into two phases: **generate** candidates, then **submit** the best ones.

### Phase 1: Generation (runs every 15 min, same as now)
- Bots write notes and score them as before
- Instead of submitting immediately, store as a **candidate**
- Skip tweets that already have a candidate (saves LLM costs)
- Log everything: note text, source URL, search results, check reasoning, tweet engagement metrics

### Phase 2: Submission (runs at end of each pipeline cycle)
- Pull all unsubmitted candidates
- Rank them by a composite score (eval + source trust + LLM helpfulness)
- Apply freshness decay: older candidates score slightly lower per hour, but a great old note still beats a mediocre fresh one
- Pick from the top using softmax sampling: mostly submits the best, occasionally explores lower-ranked notes to gather data on underweighted scoring factors
- Try to submit. If 403 "daily limit", stop.

### Quality floor
The high bar submission filter stays as a minimum. Even the top-ranked candidate doesn't get submitted if it's below the floor. Better to submit 3 good notes than 5 bad ones, especially while we're in the NH_5 trap.

## New logging
We've been throwing away useful data. Now we store for ALL pipeline runs (not just submitted notes):
- The note text and source URL
- Perplexity search results the bot used
- Full check reasoning (not just YES/NO)
- Tweet engagement at processing time (impressions, likes, retweets, follower count)

## Pipeline refactor
The current `createNotesRoutine.ts` is a 625-line monolith. We'll split it into focused modules:

- **`runPipeline.ts`** — thin orchestrator. Calls generate, then submit. This is what GitHub Actions runs.
- **`generateCandidates.ts`** — fetch tweets, skip ones with existing candidates, run bots, score, store as candidates.
- **`submitCandidates.ts`** — pull candidates from DB, rank them, try to submit until 403.
- **`candidateRanker.ts`** — composite scoring + softmax selection. Pure function, easy to tune weights.

Each file does one thing. `createNotesRoutine.ts` gets deleted.

## Expected impact
- **Better hit rate**: best notes get submitted, not just first ones
- **Lower costs**: no redundant LLM calls for tweets that already have candidates
- **More data**: comprehensive logging enables the H vs NH analysis we want to do next
- **Faster cap escape**: higher hit rate on the 5 daily slots = faster escape from NH_5 trap

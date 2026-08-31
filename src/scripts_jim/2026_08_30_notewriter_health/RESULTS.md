# Notewriter + everything-pipeline health check (GOO-72)

Checked 2026-08-31. All numbers come from `healthcheck.py` in this folder
(run it any day to refresh them). Verdict up front: **the X notewriter is
healthy**; the **everything pipeline has two real problems**, both on the
error-handling side, plus one dead follow request.

## X notewriter: healthy

- Every scheduled workflow is green: Create Notes Routine (every 30 min),
  Update Note Feedback, Tests on main, Update Ratings from CN Public Dump,
  Writing Limit Probe (one failure on Aug 28, recovered since).
- Submissions are strongly up: 9–18 notes/day a week ago (Aug 23–25), 54–68/day
  since Aug 27. The throughput work (#407/#408/#410) did what it was meant to.
  X's daily writing limit was last hit on Aug 27; not since.
- The note-needed prefilter is running again (685 `prefilter_no_note`
  rejections in 3 days).
- The **satire front gate** (#415, merged Aug 30 ~12:00 UTC) is live: it
  appears in the logs of every run on the new commits and fired on 4 of 37
  posts in its first two hours. I read all 4 reasonings; each is genuine,
  audience-obvious satire (a parkour-car joke video, a fictional "Straight of
  Ontario", an Apple polishing-cloth parody, a "made without AI" image with
  obvious AI artifacts the comments call out). No false positives so far.
- Failures are low-grade known categories, none clustered: ~8/day unfetchable
  cited sources, ~5/day sweeper-killed runs (scattered, not bursts), the
  occasional Grok/Gemini non-JSON answer, two writer char-limit failures.
- `stale_at_submit` (27 in 3 days) looked alarming as an undocumented reason
  but is an intentional cut of stale candidates in `submitCandidates.ts` from
  the throughput work. It is missing from DATABASE.md's outcome_reason
  taxonomy, as is `below_velocity_floor`.

## Everything pipeline: two real problems

Runs happen daily and notes are being written (18/day on Aug 28–29). The
daily spend cap works: Aug 28–30 each stopped at ~$52–55 of the $55 cap.
But 72 of 348 items (~21%) sit in `error`, in two families:

### 1. YouTube "No en transcript available" is almost certainly a masked fetch failure (44 items, ongoing)

44 items errored with `No en transcript available`, 41 of them at
priority > 0 (followed feeds), a steady trickle from Aug 7 through today:
Sabine Hossenfelder 17, Money & Macro 13, Stuff Made Here 5, Dwarkesh 3,
Hank's channel 3, AI Explained 2, Jeff Nippard 1. Every one of these channels
publishes in English with captions, so the message is wrong about the cause.

The code explains it: `fetchTimedTranscript`
(`src/pipeline/media/ytDlpDownload.ts:194`) swallows every yt-dlp failure
with `catch { return null; }`, and the caller
(`src/everything/sources/youtube.ts:105`) reports null as "no transcript".
So a proxy hiccup, a bot-block, or any yt-dlp error on CI is recorded as a
missing transcript, and the item is marked `error` permanently — nothing
requeues it. This silently drops followed-feed videos and violates the
fail-fast principle twice (swallowed error, then a wrong error message).

Suggested fix (not done, per Jim: report only): let the yt-dlp error
propagate with its real message, and treat transcript-fetch failures as
retryable (requeue like the spend-cap path does) instead of terminal.
The 44 items themselves are recoverable by setting them back to `queued`.

### 2. 26 items killed by the OpenRouter monthly key limit were never requeued

On Aug 21–22 the OpenRouter key hit its monthly limit and 26 items errored
with `403 Key limit exceeded`, 23 of them at priority > 0 — including
**3 reader note requests** (usefulfictions, nikudaorg, a substack profile),
which are dead: a request whose status is already `enqueued` is never looked
at again, so those readers will never get their notes unless someone re-asks
or the items are requeued by hand. The key limit is long since reset; all 26
would process fine today. Same suggested shape: a key-limit error is
transient and should requeue the item, like the spend-cap cut does.

### 3. One follow request stuck in error

`https://futuresonder.substack.com` (Aug 25) failed with a 503 from the
Substack feed relay and stays in `error`; nothing retries follow requests
either. Worth a manual flip back to `pending`. Side observation: the relay
URL in the error is `substack-feed-proxy.substack-proxy-test.workers.dev` —
the prod secret points at a worker whose subdomain says "test". If that is
the intended deployment, fine; if a prod worker exists, the secret may point
at the wrong one.

## Notes on the other half of GOO-72 (PR cleanup)

Done under GOO-75 before this check started: all 13 open PRs dispositioned
(9 merged/closed, 4 left as active work, since merged). The last two open
PRs, #418/#419, were deliberately not touched here; Jim merged them himself
on Aug 31, which makes the probe follow-ups (migrations 081 + 082, minting
the probe key) live manual items.

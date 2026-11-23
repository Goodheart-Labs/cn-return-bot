# The services machine

One always-on Linux server runs these systemd services. It is the Hetzner Cloud
server `ubuntu-8gb-hel1-1` at `95.217.155.79`, reached from the devbox with
`ssh root@95.217.155.79` (see `docs/prod-config.md`).

| Unit | What it does | Port |
|---|---|---|
| `cn-claim-check` | one claim in, a note with verified sources out | 8787 |
| `cn-extraction` | text in, the claims in it out | 8788 |
| `cn-intake` | watches reader requests and drives them through the other two | none |
| `cn-walk` | keeps every walked creator's feed on a schedule and adds their new posts to the post list (GOO-791) | none |
| `cn-fetch` | fetches outside pages, API answers and images for the other three, in a sandbox | Unix socket `/run/cn-fetch/fetch.sock` |
| `cn-pot-provider` | a Docker container that hands out YouTube PO tokens | 127.0.0.1:4416 |
| `cn-site-checks` | once a night from its timer: tests our site readers and the extension against the live sites (GOO-804) | none |
| `cn-feed-views` | every 10 minutes: records the view counts of every post in X's XL feed (GOO-834) | none |
| `cn-x-watch` | every 30 seconds: the WSDM Cup notewriter account's feed watcher, which hands new small-feed posts to Claude and submits its notes (GOO-851) | none |

The first two are pure functions behind HTTP and hold no database credentials.
Intake and the walk are callers: they hold the service key and write the rows.
The walk also tells Slack when one of our own notewriters has gone silent.

Intake is outside the feed pacing. It processes reader-requested pages at once
and spends from the full daily cap. Its spend still counts in the day's total,
so a big reader page makes the paced feed run go quiet for the rest of the day.

## The sandboxed fetcher

Pages, API answers and images from addresses a stranger or a model chose are
fetched only by `cn-fetch`. The other services send it the address over a Unix
socket and get the answer back. Every service reads pages through one function,
`readPage` in `src/pipeline/fetch/readPage.ts`: it asks the fetcher for a
site's API answer or for the fetch ladder, and adds the two steps that need
keys itself, YouTube captions and Jina Reader. A page's HTML is parsed only
inside the fetcher, so a minisite's article is built there too. The extraction
service also reads pages and the walk's listings for GitHub Actions, which
never fetches an outside address itself. Its unit file builds a sandbox around it: a throwaway
user, no environment file and so no keys, no view of `/home`, the secret files
or other processes, and a kernel rule that lets it reach public internet
addresses only. So a hostile page that tricks the fetch code into reading
something on this machine finds nothing worth taking. The other services refuse
to start without `FETCH_SERVICE_SOCKET`, which their unit files set, so they
never fall back to fetching next to the keys. The services start `cn-fetch`
themselves, because their units want it, and autodeploy restarts it with them.

## First-time setup

```bash
# as root on a fresh Ubuntu server
git clone https://github.com/Goodheart-Labs/cn-return-bot.git /opt/cn-return-bot
bash /opt/cn-return-bot/ops/setup-vm.sh
# fill in /etc/cn-return-bot/service.env (below)
systemctl start cn-claim-check cn-extraction cn-intake cn-walk
```

On a machine set up before cn-walk existed (GOO-791), add YOUTUBE_WEBSUB_SECRET
and SLACK_BOT_TOKEN to service.env (below), then run once as root:

```bash
cp /opt/cn-return-bot/ops/cn-walk.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cn-walk
```

Before that, `bun run cn-walk --dry-run` on the devbox reads the Substack and
forum feeds against production and prints what it would add, writing nothing.

## /etc/cn-return-bot/service.env

Every variable, one per line, `NAME=value`. The services fail at startup on a
missing required one, which is intended.

```
# Shared secret the callers present. Generate once: openssl rand -hex 32
SERVICE_AUTH_SECRET=

# Model access (claim checking and extraction)
OPENROUTER_API_KEY=
GEMINI_API_KEY=
GEMINI_API_KEY_FREE=
GROQ_API_KEY=
XAI_API_KEY=
SERPER_API_KEY=
# Jina Reader: a paid last resort for a page that every free fetch step failed
# on, and for an API that a bot check keeps closed even to headless Chromium,
# such as the EA Forum's. Every service that reads pages uses it while
# JINA_FALLBACK in src/pipeline/fetch/jinaReader.ts is on. A missing key throws
# on the first read that needs Jina.
JINA_API_KEY=

# The scoring step inside a claim check calls X's evaluate-note API
# (read by src/api/getOAuthToken.ts)
X_API_KEY=
X_API_KEY_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# Intake only: it writes the rows the browser watches
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Intake calls the other two services on this same machine
CLAIM_CHECK_URL=http://localhost:8787
EXTRACTION_URL=http://localhost:8788

# YouTube Data API key: video details for a requested YouTube page (intake),
# and the walk's channel listings. 10,000 free quota units a day per project.
YOUTUBE_DATA_V3_API_KEY=

# The walk: shared with the youtube-websub Edge Function. The walk sends it to
# Google's WebSub hub with each channel subscription.
YOUTUBE_WEBSUB_SECRET=
# The walk: the bot token of the Slack app "Claudy", for the silence warnings.
SLACK_BOT_TOKEN=

# YouTube needs the residential proxy here, exactly as it does on GitHub's
# runners. Measured on this machine on 2026-09-08: every per-video call answers
# "Sign in to confirm you're not a bot", while channel listings still work. It
# is the IP, not the client: enabling a JavaScript runtime changes nothing, and
# a netcup VPS that reached YouTube directly in July is now refused as well.
YTDLP_PROXY_URL=

# Optional knobs, with their defaults
#CLAIM_CHECK_PORT=8787
#CLAIM_CHECK_CONCURRENCY=6
#CLAIM_CHECK_RESERVED_FOR_READER=2
#EXTRACTION_PORT=8788
#EXTRACTION_CONCURRENCY=2
#EVERYTHING_DAILY_SPEND_CAP_USD=50
#EVERYTHING_REQUEST_RESERVE_USD=10
```

## The PO token provider (caption downloads)

Intake fetches YouTube captions for pages readers ask for. yt-dlp downloads
them as YouTube's web player, which must present a PO token, a proof that the
request comes from a real player. The pipeline asks a small local server for
one token per video and passes it to yt-dlp. That server is the
`brainicism/bgutil-ytdlp-pot-provider` Docker image, run by
`cn-pot-provider.service` on 127.0.0.1:4416. `setup-vm.sh` installs Docker
and the unit.

On a machine set up before this existed, run once as root:

```bash
apt-get install -y --no-install-recommends docker.io
cp /opt/cn-return-bot/ops/cn-pot-provider.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cn-pot-provider
curl -s http://127.0.0.1:4416/ping    # answers with its version
```

Then add `YOUTUBE_DATA_V3_API_KEY=` to the environment file and
`systemctl restart cn-intake`. A caption download without the provider fails
with "The PO token provider at http://127.0.0.1:4416 did not answer", which
is the line to look for in `journalctl -u cn-intake`.

## The daily site checks

`cn-site-checks.timer` starts `cn-site-checks.service` every night at 22:00
UTC. It builds the extension against production, runs `bun run site-checks
--save` (src/site-checks/), and saves the report in the table
`site_check_runs`. The devbox's CI checker Claude reads it at 23:00 UTC with
`bun run site-checks-latest`. The checks run here because Substack refuses
GitHub's machines (measured 2026-11-19: its API answered 403 and its pages
never loaded), and because this machine holds the residential proxy, which the
YouTube watch-page checks go through. The proxy is paid per gigabyte, so the
report says how many megabytes they took.

The build needs `SUPABASE_ANON_KEY` in service.env, the public key that every
copy of the extension carries. Once, as root:

```bash
cp /opt/cn-return-bot/ops/cn-site-checks.service /opt/cn-return-bot/ops/cn-site-checks.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cn-site-checks.timer
systemctl start --no-block cn-site-checks   # a first run now, to see it work
journalctl -u cn-site-checks -f
```

## The feed view recorder

`cn-feed-views` (src/feed-views/main.ts, GOO-834) reads the small, large and
XL tiers of X's eligible-posts feed every 10 minutes, on the clock, with the
notewriter keys in service.env. It stores one reading of each XL post's views
and other counts in `feed_tweet_views`, one row per walk of the feed in
`feed_view_walks` (migration 193), and each post's profile at first sight in
`feed_view_posts` (migration 195). X's budget of 500 requests per 15 minutes
is shared with the X run, so a walk stops when fewer than 150 are left. When
an hour passes without a walk that completed and was stored, it tells Slack.
It does not write `feed_tweets`, which keeps what the X run saw first. It is a one-time
collection of at most 14 days (GOO-845). Once, as root:

```bash
cp /opt/cn-return-bot/ops/cn-feed-views.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cn-feed-views
journalctl -u cn-feed-views -f      # a "walk complete" line every 10 minutes
```

`bun run cn-feed-views --dry-run` makes one walk and writes nothing.

## The WSDM Cup notewriter's feed watcher

`cn-x-watch` (src/x-watch/main.ts, GOO-851) writes the notes of the second X
notewriter account, the WSDM Cup account. The unit sets `X_ACCOUNT=wsdm`, and
the account's four keys are these lines of service.env:

```
X_WSDM_API_KEY=
X_WSDM_API_KEY_SECRET=
X_WSDM_ACCESS_TOKEN=
X_WSDM_ACCESS_TOKEN_SECRET=
```

Every 30 seconds it sweeps the account's stale Claude tweets, submits the
notes Claude wrote, and, while the writing limit has room, reads the account's
small feed and hands each new post to the runner on ai-box. Until X admits the
account it works in test mode: it writes only as many test notes as allowed,
and checks hourly whether X admitted it. `bun run x-watch-allow-test-notes <n>`
allows n more, and Slack hears when a batch is written and scored. The account has its own budget of 500 feed requests per
15 minutes, so it shares nothing with the X run or cn-feed-views. When an hour
passes without a good tick, it tells Slack. Once, as root:

```bash
cp /opt/cn-return-bot/ops/cn-x-watch.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cn-x-watch
journalctl -u cn-x-watch -f
```

`bun run x-watch-test-notes` lists the account's test notes
with X's evaluator scores.

## Deploys

The machine pulls; GitHub never pushes to it and holds no SSH key for it. A
systemd timer (`cn-autodeploy.timer`, every 5 minutes) runs
`/usr/local/sbin/cn-autodeploy`, root's own copy of `ops/autodeploy.sh`. It asks
GitHub which commit is on `main` and, when that commit is new AND both services
answer their health endpoint with nothing in flight and nothing waiting, has
the service user reset the checkout to it and reinstall dependencies. Then it
installs the unit files and its own new copy, downloaded from GitHub at that
same commit, and restarts the services. Root never runs or installs a file
from the checkout, because the checkout belongs to the service user and a
process running as that user could change it. A busy machine simply deploys a few minutes later
when it drains; a service that does not answer health counts as idle, because
the new commit may be the fix. So a merge to main is live within about five
minutes of the machine going quiet.

The same script upgrades yt-dlp once a day with `pipx upgrade`, also only on an
idle machine, because yt-dlp needs a new release every time YouTube changes its
player. The time of the last upgrade is the modification time of
`/var/lib/cn-autodeploy/yt-dlp-upgraded`; delete that file to upgrade on the
next tick. A failed upgrade fails the `cn-autodeploy` unit, which
`journalctl -u cn-autodeploy` shows.

The machine always deploys `main`, whatever branch the checkout is on.

## Moving to a new machine

Only two things find this machine: the repository secrets `CLAIM_CHECK_URL` and
`EXTRACTION_URL`, which the X note writer and the Common Notes feed run read when
they start. Everything else on the machine either waits to be called, or, like
`cn-intake`, looks for work in the database by itself. Two copies of intake
would both take the same reader request. So the two machines must never run it
at the same time.

The move on 2026-10-08 (GOO-244) went like this, with about 15 minutes of
downtime:

1. Build the new machine with "First-time setup" above, but start only
   `cn-claim-check` and `cn-extraction`. `setup-vm.sh` enables intake, so run
   `systemctl disable cn-intake` right after it.
2. Pause both pipeline workflows:
   `gh workflow disable everything-priority-feeds.yml` and
   `gh workflow disable create-notes-routine-dynamic.yml`. pg_cron's dispatches
   fail while they are off, which is harmless.
3. Wait until no run is in progress and both services on the old machine show
   `inFlight` 0 and `waiting` 0 on `/health`, and intake is not working on a page.
4. On the old machine, switch everything off. `disable` keeps a reboot from
   bringing it back:
   `systemctl disable --now cn-autodeploy.timer cn-intake cn-claim-check cn-extraction cn-fetch cn-pot-provider`.
5. Copy the environment file machine to machine without printing it, and
   compare the hashes:
   ```bash
   ssh root@<old> 'cat /etc/cn-return-bot/service.env' | ssh root@<new> 'umask 077; cat > /etc/cn-return-bot/service.env'
   for ip in <old> <new>; do ssh root@$ip 'sha256sum /etc/cn-return-bot/service.env | cut -c1-16'; done
   ```
6. On the new machine, restart the two called services so they read the file,
   and switch on the other two:
   `systemctl restart cn-claim-check cn-extraction && systemctl enable --now cn-intake cn-fetch`.
7. Point `CLAIM_CHECK_URL` and `EXTRACTION_URL` at the new address with
   `gh secret set`, then `gh workflow enable` both workflows and watch one run
   of each finish green.
8. Once the new machine has served a few runs, delete the old one in the
   Hetzner console. Powering it off does not stop the bill. Check first that
   Hetzner holds no snapshots of it, because those are billed separately and
   survive the deletion.

Rollback is the same steps in the other direction. With no machine at all, the
Actions runs fail loudly at their health check, which is the intended signal.

## Looking at it

```bash
journalctl -u cn-intake -f                 # live logs, same for the other units
curl -H "x-cn-service-key: $SECRET" http://localhost:8787/health
```

From 2026-11-12 to 2026-11-19 the services recorded every page and listing
they read (GOO-766): a row in the table `page_reads`, and the same record with
the text that came back as a line in `/var/lib/cn-page-reads/<day>.jsonl`. A
line with `text_same_as` names the line that holds its text. The recording
was removed once there was enough data to study the fetcher (GOO-826). The
table and the files stay for that.

```bash
jq -c 'select(.outcome != "page") | {input, reason, steps}' /var/lib/cn-page-reads/<day>.jsonl                              # one day's failed reads
jq -r 'select(.input == "<url>") | .text' /var/lib/cn-page-reads/<day>.jsonl                              # what one read gave
```

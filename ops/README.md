# The services machine

One always-on Linux server runs six systemd services. It is the Hetzner Cloud
server `ubuntu-8gb-hel1-1` at `95.217.155.79`, reached from the devbox with
`ssh root@95.217.155.79` (see `docs/prod-config.md`).

| Unit | What it does | Port |
|---|---|---|
| `cn-claim-check` | one claim in, a note with verified sources out | 8787 |
| `cn-extraction` | text in, the claims in it out | 8788 |
| `cn-intake` | watches reader requests and drives them through the other two | none |
| `cn-fetch` | fetches outside pages and images for the other three, in a sandbox | Unix socket `/run/cn-fetch/fetch.sock` |
| `cn-notify` | posts new notes and votes to four Slack channels | none |
| `cn-pot-provider` | a Docker container that hands out YouTube PO tokens | 127.0.0.1:4416 |

The first two are pure functions behind HTTP and hold no database credentials.
Intake is a caller: it holds the service key and writes the rows. The Actions
pipelines are the monitor; nothing on this machine phones home.

Intake is outside the feed pacing. It processes reader-requested pages at once
and spends from the full daily cap. Its spend still counts in the day's total,
so a big reader page makes the paced feed run go quiet for the rest of the day.

## The sandboxed fetcher

Pages and images from addresses a stranger or a model chose are fetched only
by `cn-fetch`. The other services send it the address over a Unix socket and
get the page text back. Its unit file builds a sandbox around it: a throwaway
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
systemctl start cn-claim-check cn-extraction cn-intake cn-notify
```

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

# YouTube Data API key (intake): video details for a requested YouTube page.
# The same key the feed run uses; 10,000 free quota units a day per project.
YOUTUBE_DATA_V3_API_KEY=

# YouTube needs the residential proxy here, exactly as it does on GitHub's
# runners. Measured on this machine on 2026-09-08: every per-video call answers
# "Sign in to confirm you're not a bot", while channel listings still work. It
# is the IP, not the client: enabling a JavaScript runtime changes nothing, and
# a netcup VPS that reached YouTube directly in July is now refused as well.
YTDLP_PROXY_URL=
# Substack does not need its relay here. The same measurement fetched two RSS
# feeds and the api/v1 archive endpoint directly, all 200. Leave these unset.
#SUBSTACK_PROXY_URL=
#SUBSTACK_PROXY_KEY=

# Slack bot token of "Claudy" (src/utils/slack.ts), the same one the devbox uses.
# Needed only by code that posts to Slack; see "Posting to Slack" below.
SLACK_BOT_TOKEN=

# cn-notify only: the ids of the four channels it posts to (see "Slack
# announcements" below). It refuses to start without all four.
SLACK_CHANNEL_ON_IMPORTANT_CREATOR=
SLACK_CHANNEL_WRITTEN_BY_HUMAN=
SLACK_CHANNEL_FIRST_HELPFUL_VOTE=
SLACK_CHANNEL_HELPFUL=

# Optional knobs, with their defaults
#CLAIM_CHECK_PORT=8787
#CLAIM_CHECK_CONCURRENCY=6
#CLAIM_CHECK_RESERVED_FOR_READER=2
#EXTRACTION_PORT=8788
#EXTRACTION_CONCURRENCY=2
#EVERYTHING_DAILY_SPEND_CAP_USD=50
#EVERYTHING_REQUEST_RESERVE_USD=10
```

## Posting to Slack

Code in this repository posts to Slack with `postSlackMessage` from
`src/utils/slack.ts`. It posts as the bot "Claudy", the same Slack app the
devbox uses (the devbox repository's README explains how the app was made). It
needs `SLACK_BOT_TOKEN`, from the environment file on this machine or from the
repository secret of the same name in GitHub Actions. It throws when Slack
refuses a message, for example with `not_in_channel` when nobody has invited
the bot to the channel.

```ts
const ts = await postSlackMessage({ channel: "C08ABCDEF", markdown: "A *new* note" });
await postSlackMessage({ channel: "C08ABCDEF", markdown: "More detail", threadTs: ts });
```

A channel is addressed by its id, which Slack shows at the bottom of the
channel's details. Invite the bot to the channel first: type `/invite @Claudy`
in it. Keep each channel id in its own environment variable, named after what
the channel is for, so the code never contains one.

To check the token on this machine, as root. The package script calls `bun`
by name, and root's PATH does not include it, so the first line adds it:

```bash
export PATH=/home/cnbot/.bun/bin:$PATH
cd /opt/cn-return-bot && set -a && . /etc/cn-return-bot/service.env && set +a
bun run slack-send C0C638V19ED "hello from the services machine"
```

`C0C638V19ED` is #daily-report. `C0C5XD2G0DR` is #trending-posts, where the
Trending Posts workflow posts (`src/production/postTrendingPosts.ts`).

## Slack announcements (cn-notify)

`cn-notify` (`src/service/notify/`) checks the database once a minute and
posts to four channels:

| Channel | Id | What it announces |
|---|---|---|
| #on-important-creator | `C0C5N7EE6RM` | New notes on Astral Codex Ten, Andy Masley, Bentham's Bulldog, Predictive Text and Don't Worry About the Vase. Our AI's notes on one post come as one message once the post is finished. A note a person wrote comes on its own. |
| #written-by-human | `C0C6CEFJT9A` | Every note a person wrote or improved, on any creator. |
| #first-helpful-vote | `C0C5Y8WB02Z` | A note's first Helpful vote from someone other than its author. |
| #helpful | `C0C5Y91UMA9` | A note that became rated helpful, by the website's rule (`noteStatus`). |

The list of creators is `IMPORTANT_CREATOR_FEED_URLS` in
`src/service/notify/announcements.ts`. The table
`everything_slack_announcements` remembers what was posted, so nothing is
posted twice. Each check looks at the last 24 hours, so the service can be
stopped for most of a day without missing anything.

`cn-notify` was added after the machine was set up, and autodeploy only
restarts units that are already running. So it was installed by hand once, as
root:

```bash
cp /opt/cn-return-bot/ops/cn-notify.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cn-notify
journalctl -u cn-notify -f
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

## Deploys

The machine pulls; GitHub never pushes to it and holds no SSH key for it. A
systemd timer (`cn-autodeploy.timer`, every 5 minutes) runs `ops/autodeploy.sh`,
which fetches the branch the checkout is on and, when there is a new commit AND
both services answer their health endpoint with nothing in flight and nothing
waiting, resets to it, reinstalls dependencies, refreshes the unit files, and
restarts the three services. A busy machine simply deploys a few minutes later
when it drains; a service that does not answer health counts as idle, because
the new commit may be the fix. So a merge to main is live within about five
minutes of the machine going quiet.

The checkout tracks whichever branch it is on, which is `main`.

## Moving to a new machine

Only two things find this machine: the repository secrets `CLAIM_CHECK_URL` and
`EXTRACTION_URL`, which the X note writer and the Common Notes feed run read when
they start. Everything else on the machine either waits to be called, or, like
`cn-intake` and `cn-notify`, looks for work in the database by itself. Two
copies of intake would both take the same reader request, and two copies of
notify could post the same message twice. So the two machines must never run
those at the same time.

The move on 2026-10-08 (GOO-244) went like this, with about 15 minutes of
downtime:

1. Build the new machine with "First-time setup" above, but start only
   `cn-claim-check` and `cn-extraction`. `setup-vm.sh` enables intake and
   notify, so run `systemctl disable cn-intake cn-notify` right after it.
2. Pause both pipeline workflows:
   `gh workflow disable everything-priority-feeds.yml` and
   `gh workflow disable create-notes-routine-dynamic.yml`. pg_cron's dispatches
   fail while they are off, which is harmless.
3. Wait until no run is in progress and both services on the old machine show
   `inFlight` 0 and `waiting` 0 on `/health`, and intake is not working on a page.
4. On the old machine, switch everything off. `disable` keeps a reboot from
   bringing it back:
   `systemctl disable --now cn-autodeploy.timer cn-intake cn-notify cn-claim-check cn-extraction cn-fetch cn-pot-provider`.
5. Copy the environment file machine to machine without printing it, and
   compare the hashes:
   ```bash
   ssh root@<old> 'cat /etc/cn-return-bot/service.env' | ssh root@<new> 'umask 077; cat > /etc/cn-return-bot/service.env'
   for ip in <old> <new>; do ssh root@$ip 'sha256sum /etc/cn-return-bot/service.env | cut -c1-16'; done
   ```
6. On the new machine, restart the two called services so they read the file,
   and switch on the other two:
   `systemctl restart cn-claim-check cn-extraction && systemctl enable --now cn-intake cn-notify cn-fetch`.
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

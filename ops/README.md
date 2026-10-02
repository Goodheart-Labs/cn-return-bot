# The services machine

One always-on Linux server runs five systemd services:

| Unit | What it does | Port |
|---|---|---|
| `cn-claim-check` | one claim in, a note with verified sources out | 8787 |
| `cn-extraction` | text in, the claims in it out | 8788 |
| `cn-intake` | watches reader requests and drives them through the other two | none |
| `cn-fetch` | fetches outside pages and images for the other three, in a sandbox | Unix socket `/run/cn-fetch/fetch.sock` |
| `cn-notify` | posts new notes and votes to four Slack channels | none |

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
systemctl start cn-claim-check cn-extraction cn-intake
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

`C0C638V19ED` is #daily-report.

## Slack announcements (cn-notify)

`cn-notify` (`src/service/notify/`) checks the database once a minute and
posts to four channels:

| Channel | What it announces |
|---|---|
| #on-important-creator | New notes on Astral Codex Ten, Andy Masley, Bentham's Bulldog, Predictive Text and Don't Worry About the Vase. Our AI's notes on one post come as one message once the post is finished. A note a person wrote comes on its own. |
| #written-by-human | Every note a person wrote or improved, on any creator. |
| #first-helpful-vote | A note's first Helpful vote from someone other than its author. |
| #helpful | A note that became rated helpful, by the website's rule (`noteStatus`). |

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

The checkout tracks whichever branch it is on: the feature branch before the
cutover PR merges, `main` after (switch once by hand with
`sudo -u cnbot git -C /opt/cn-return-bot checkout main`).

## Rollback

```bash
systemctl stop cn-claim-check cn-extraction cn-intake
```

Then re-enable the old in-process path by reverting the cutover commit on main,
or by dispatching the workflows manually while investigating. The Actions runs
fail loudly while the machine is down, which is the intended signal, not a
side effect.

## Looking at it

```bash
journalctl -u cn-intake -f                 # live logs, same for the other units
curl -H "x-cn-service-key: $SECRET" http://localhost:8787/health
```

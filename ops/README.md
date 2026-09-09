# The services machine

One always-on Linux server runs three systemd services:

| Unit | What it does | Port |
|---|---|---|
| `cn-claim-check` | one claim in, a note with verified sources out | 8787 |
| `cn-extraction` | text in, the claims in it out | 8788 |
| `cn-intake` | watches reader requests and drives them through the other two | none |

The first two are pure functions behind HTTP and hold no database credentials.
Intake is a caller: it holds the service key and writes the rows. The Actions
pipelines are the monitor; nothing on this machine phones home.

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

# Optional knobs, with their defaults
#CLAIM_CHECK_PORT=8787
#CLAIM_CHECK_CONCURRENCY=6
#CLAIM_CHECK_RESERVED_FOR_READER=2
#EXTRACTION_PORT=8788
#EXTRACTION_CONCURRENCY=2
#EVERYTHING_DAILY_SPEND_CAP_USD=55
#EVERYTHING_REQUEST_RESERVE_USD=10
```

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

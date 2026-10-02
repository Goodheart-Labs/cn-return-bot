# Production settings outside the code

This page lists every production setting that lives outside the repository.
Someone set each one by hand in a web dashboard or with a command line tool.
Reading the code does not tell you their values, so this page does.

Secrets appear by name only. Their values live in the systems named here.

The services machine has its own environment file. That file is described in
[ops/README.md](../ops/README.md) and is not repeated here.

Values marked "checked on 2026-10-01" were read from the live system on that
day. Everything else is what the code expects, and nobody has confirmed it
against the live system yet.

## Supabase

Supabase is the hosted Postgres database with built-in sign-in that the bot
and Common Notes use. The production project has the reference
`ugytvkevhsmcpunfvncw`, so its address is
`https://ugytvkevhsmcpunfvncw.supabase.co`. That address is public, because the
website and the extension carry it.

The file [supabase/config.toml](../supabase/config.toml) configures only the
local development copy of Supabase. Every setting below must be made a second
time in the production project's dashboard.

### Sign-in addresses

Two settings sit under Authentication → URL Configuration.

The **Site URL** is the address Supabase sends a user to when it has no
better address. That happens when a sign-in asks to return to an address
that is not on the allow-list.

The **redirect allow-list** (the dashboard calls it "Redirect URLs") is the
list of addresses Supabase may send a user back to after signing in with X. A
`**` at the end matches any path below that address. Email sign-in uses a
typed code and never redirects, so it needs no entry here.

| Setting | Value |
|---|---|
| Site URL | `https://commonnotes.net/` (checked on 2026-10-01) |

Paste-ready allow-list:

```
https://commonnotes.net/**
https://www.commonnotes.net/**
https://goodheart-labs.github.io/cn-return-bot/notes/**
http://localhost:8003/**
http://localhost:8004/**
https://jodkhmefbcmgldokmeicpdogkepmcnij.chromiumapp.org/**
https://edc17663d98cd6a49556fdc1882c73dace1728c1.extensions.allizom.org/**
```

The first three lines are the website on its own domain and on GitHub Pages.
The website asks X sign-in to return to the page the reader was on, in
`signInWithTwitter` in
[src/everything-core/auth.ts](../src/everything-core/auth.ts).

The two localhost lines let X sign-in work on a developer's machine while it
talks to the production database. Port 8003 is the website and port 8004 is
the analytics dashboard.

The last two lines are the browser extension's own return addresses. The
extension's background script asks the browser for its return address with
`browser.identity.getRedirectURL()` and passes it to Supabase, in
[entrypoints/background.ts](../src/everything-extension/entrypoints/background.ts).

- The Chrome address contains the Chrome extension ID. Chrome derives that ID
  from the public key in
  [wxt.config.ts](../src/everything-extension/wxt.config.ts). The ID was
  recomputed from that key on 2026-10-01 and matches.
- The Firefox address contains the SHA-1 hash of the Firefox add-on ID
  `extension@commonnotes.net`, which is also set in `wxt.config.ts`. The hash
  was recomputed on 2026-10-01 and matches.

If either extension ID ever changes, its line here must change too.

### Sign-in methods

These settings sit under Authentication → Sign In / Providers, and under
Authentication → Emails.

| Setting | Value | Why it matters |
|---|---|---|
| Email provider | on (checked on 2026-10-01) | Email sign-in by a typed code. |
| Confirm email | on (checked on 2026-10-01) | Supabase then sends a code when an anonymous account adds an email address. |
| Secure email change | on (checked on 2026-10-01) | Supabase's default. |
| Email OTP length | `6` (checked on 2026-10-01) | An OTP is a one-time password, here the code in the sign-in email. The sign-in form waits for exactly this many characters, from `EMAIL_OTP_LENGTH` in [src/everything-core/auth.ts](../src/everything-core/auth.ts). Change both together. |
| Email OTP expiry | `300` seconds (checked on 2026-10-01) | Matches `otp_expiry` in `config.toml`. |
| Anonymous sign-ins | on (checked on 2026-10-01) | Voting and writing a note create an invisible account through `signInAnonymously` in `ensureUser` in [src/everything-core/auth.ts](../src/everything-core/auth.ts). With this off, a signed-out reader sees the sign-in form instead. |
| Manual linking | on | Manual linking lets an anonymous account attach an X identity later and keep its votes. The code calls `linkIdentity` for this and falls back to a plain X sign-in when linking is refused, which leaves the anonymous account's votes behind. |
| Twitter provider | on (checked on 2026-10-01) | X sign-in. See "X developer apps" below for its credentials. |
| X provider | off (checked on 2026-10-01) | Supabase's newer OAuth 2.0 provider for X. The code asks for `"twitter"`, not `"x"`. |

### Email templates

Supabase sends three kinds of email to Common Notes users. Each one must show
the code (`{{ .Token }}`) and no link, because both the website and the
extension ask the reader to type the code. The repository holds the wanted
text. Paste each file into Authentication → Emails → Templates.

| Template in the dashboard | Repository file | Subject |
|---|---|---|
| Confirm signup | [supabase/templates/confirmation.html](../supabase/templates/confirmation.html) | Confirm your email for Common Notes |
| Magic Link | [supabase/templates/magic_link.html](../supabase/templates/magic_link.html) | Sign in to Common Notes |
| Change Email Address | [supabase/templates/email_change.html](../supabase/templates/email_change.html) | Confirm your email for Common Notes |

New users get the "Confirm signup" email and returning users the "Magic Link"
email, so both matter. The "Change Email Address" email reaches an anonymous
reader who adds an email address to keep their votes.

If the Change Email Address template keeps Supabase's default, it sends a
link and no code. A reader who adds an email address then cannot finish,
because the form waits for a code that never arrives.

### Outgoing email

Supabase sends its emails through Resend, an email delivery service, over
SMTP, the standard protocol for sending mail. This sits under Authentication →
Emails → SMTP Settings.

| Setting | Value (checked on 2026-10-01) |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key (secret) |
| Sender address | `notes@commonnotes.net` |
| Sender name | `Common Notes` |
| Emails per hour | `100` (Authentication → Rate Limits) |

Resend only sends from `commonnotes.net` because the domain proves ownership
with DNS records. DNS is the system that maps domain names to servers and
holds such proof records. A Resend record exists in the domain's DNS at
Cloudflare (checked on 2026-10-01). Which Resend account owns the domain was
not checked.

### Vault and scheduled jobs

**Vault** is Supabase's encrypted store for secrets inside the database. SQL
can read a secret by name, but the value never appears in the code.

**pg_cron** is a Postgres extension that runs SQL on a timetable, like the
Unix `cron` daemon. **pg_net** is a Postgres extension that lets SQL send
HTTP requests. Together they start GitHub Actions workflows on time, because
GitHub's own timetable delays and drops runs.

One Vault secret exists (checked on 2026-10-01):

| Name | What it is |
|---|---|
| `github_dispatch_pat` | A GitHub personal access token, or PAT. A PAT is a password-like token that lets a program act on GitHub as the person who made it. This one must allow "Actions: read and write" on the `Goodheart-Labs/cn-return-bot` repository. It was created on 2026-06-30. |

When the PAT expires or is revoked, every scheduled dispatch fails quietly
inside the database. To replace it, run this in the SQL editor:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'github_dispatch_pat'),
  'github_pat_NEW_VALUE'
);
```

The migrations create these jobs, but a person applies the migrations by hand,
so the live list is recorded here (checked on 2026-10-01):

| Job name | Timetable | What it does | Created by |
|---|---|---|---|
| `dispatch-create-notes` | `18,48 * * * *` | Starts the Create Notes Routine workflow twice an hour. | [migrations/047](../migrations/047_schedule_create_notes_dispatch.sql) |
| `dispatch-everything-priority-feeds` | `* * * * *` | Every minute, starts the Everything Priority Feeds workflow if its alarm has come. | [migrations/098](../migrations/098_feed_alarm.sql) |
| `cleanup-cron-history` | `17 3 * * *` | Deletes pg_cron's own history older than 7 days. | [migrations/098](../migrations/098_feed_alarm.sql) |
| `refresh-review-dashboard-base` | `0 * * * *` | Refreshes the review dashboard's cached table. | [migrations/080](../migrations/080_slow_review_dashboard_refresh.sql) |

Both dispatch jobs read `github_dispatch_pat` from Vault. To pause one job
without removing it, run `select cron.alter_job(job_id := <jobid>, active := false);`.

### Edge Functions

An **Edge Function** is a small program that Supabase hosts and runs when its
address is called.

| Function | How it is deployed | Secrets it needs |
|---|---|---|
| `youtube-websub` | `supabase functions deploy youtube-websub --no-verify-jwt` | `YOUTUBE_WEBSUB_SECRET` |

The flag `--no-verify-jwt` lets callers in without a Supabase sign-in token.
A JWT is the signed token Supabase normally demands on every call. Google's
notification service sends no such token, so the function checks Google's
own signature instead. The live function had JWT checking off on
2026-10-01.

Set the secret with `supabase secrets set YOUTUBE_WEBSUB_SECRET=...`. It must
hold the same value as the GitHub secret of the same name. Supabase supplies
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to every function by itself.

The function's address is
`https://ugytvkevhsmcpunfvncw.supabase.co/functions/v1/youtube-websub`. The
code is in
[supabase/functions/youtube-websub/index.ts](../supabase/functions/youtube-websub/index.ts).

## GitHub

### Repository secrets

A repository secret is a value stored in the repository's settings (Settings →
Secrets and variables → Actions). Workflows read it at run time, and GitHub
hides it in logs. The names below were checked against the live repository on
2026-10-01.

| Purpose | Secrets | Used by |
|---|---|---|
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | Most workflows. The anon key is the public key built into the website and the extension. |
| X API for the notewriter account | `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | The note-writing, feedback, capture and probe workflows. |
| Language models and search | `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `SERPER_API_KEY`, `PANGRAM_API_KEY` | Create Notes Routine and Everything Priority Feeds. Pangram is also used by the AI-detection workflow, and xAI by Trending Posts. |
| The services machine | `CLAIM_CHECK_URL`, `EXTRACTION_URL`, `SERVICE_AUTH_SECRET` | The two pipeline workflows call the services described in [ops/README.md](../ops/README.md). |
| YouTube | `YOUTUBE_DATA_V3_API_KEY`, `YOUTUBE_WEBSUB_SECRET`, `YTDLP_PROXY_URL` | Everything Priority Feeds. The proxy is also used by Create Notes Routine and the timestamp backfill. |
| Substack relay | `SUBSTACK_PROXY_URL`, `SUBSTACK_PROXY_KEY` | Everything Priority Feeds. |
| Cloudflare Pages | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploy Pages, for commonnotes.net. |
| Slack | `SLACK_BOT_TOKEN` | `postSlackMessage` in `src/utils/slack.ts`, which posts as the bot "Claudy". Trending Posts uses it. See [ops/README.md](../ops/README.md). |

The workflow `writing-limit-probe.yml` also reads `SUPABASE_PROBE_KEY`, a key
limited to that probe's own table. When it is unset, the probe falls back to
the service key.

### Repository variables

A repository variable is like a secret but readable in logs. No variable was
set on 2026-10-01, so the code's defaults apply:

| Variable | Default when unset | Read in |
|---|---|---|
| `EVERYTHING_DAILY_SPEND_CAP_USD` | 50 | [src/everything/spendCap.ts](../src/everything/spendCap.ts) |
| `CAPACITY_BAR_ENABLED` | on | [src/pipeline/capacity/window.ts](../src/pipeline/capacity/window.ts) |
| `NOTE_RATER_ENABLED` | on | [src/pipeline/score/noteRater.ts](../src/pipeline/score/noteRater.ts) |
| `NOTE_QUEUE_ENABLED` | on | [src/pipeline/orchestration/noteQueue.ts](../src/pipeline/orchestration/noteQueue.ts) |
| `NOTE_BAR_MIN_NET` | 0.05 | [src/pipeline/score/raterBar.ts](../src/pipeline/score/raterBar.ts) |

### GitHub Pages

GitHub Pages is GitHub's static website hosting. Under Settings → Pages the
source is "GitHub Actions" (checked on 2026-10-01), so the Deploy Pages
workflow publishes the site. The site lives at
`https://goodheart-labs.github.io/cn-return-bot/` and has no custom domain. It
holds the stats dashboard and the analytics dashboard. The Common Notes
website used to have a copy at `/cn-return-bot/notes/`. That copy is gone, and
its addresses now redirect to the same page on commonnotes.net.

## Cloudflare

Cloudflare runs the DNS for `commonnotes.net`, hosts the website on that
domain, and runs the Substack relay. The domain's name servers are
Cloudflare's (checked on 2026-10-01).

### Cloudflare Pages: commonnotes.net

Cloudflare Pages is Cloudflare's static website hosting. The Pages project is
named `commonnotes`. Both `commonnotes.net` and `www.commonnotes.net` answer
(checked on 2026-10-01). How the two addresses are attached to the project in
the Cloudflare dashboard was not checked.

The website on this domain changes only when someone deploys it by hand. Open
the "Deploy Pages" workflow in GitHub Actions and press "Run workflow". Only a
run started that way includes the Cloudflare step. Runs started by a merge or
by the four-hourly timetable update GitHub Pages alone. The step is in
[.github/workflows/deploy-pages.yml](../.github/workflows/deploy-pages.yml),
and it needs the two Cloudflare secrets above. The API token must be allowed
to edit Cloudflare Pages.

### Google Search Console

commonnotes.net is verified in Google Search Console as a URL-prefix
property, with the file
[google557ce68cd0dd730c.html](../src/everything-web/public/google557ce68cd0dd730c.html)
that Google handed out (2026-10-02). Google checks it again from time to time,
so the file must stay on the deployed site. The verification is what lets the
Chrome Web Store listing name commonnotes.net as its "Official URL" with a
verified badge.

### The Substack relay Worker

A Cloudflare Worker is a small program that Cloudflare runs on its own
servers. Ours is named `substack-feed-proxy`. It fetches Substack RSS feeds for
the pipeline, because Substack refuses requests from GitHub's machines. The
code and its deploy steps are in
[src/everything/substack-proxy-worker/](../src/everything/substack-proxy-worker/README.md).
It runs on Jim's Cloudflare account, on the free plan.

Settings that live only in Cloudflare:

- The Worker secret `PROXY_KEY`, set with `bunx wrangler secret put PROXY_KEY`.
  It must hold the same value as the GitHub secret `SUBSTACK_PROXY_KEY`.
- The Worker's address, which goes into the GitHub secret `SUBSTACK_PROXY_URL`.
- The KV namespace `FEEDS`. KV is Cloudflare's key-value storage. Its id is in
  [wrangler.toml](../src/everything/substack-proxy-worker/wrangler.toml).

The free plan allows 1,000 KV writes a day, which is enough for about 13
feeds. The README explains what to change when that runs out.

A person deploys the Worker by hand with `bunx wrangler deploy`. No workflow
deploys it.

## Google

### YouTube Data API key

The YouTube Data API v3 is Google's official interface for reading channel
and video information. Its key lives in a Google Cloud project and is stored
as `YOUTUBE_DATA_V3_API_KEY` in GitHub and on the services machine. The key
allows 10,000 quota units a day, and the count resets at midnight Pacific
time. The code is in
[src/pipeline/media/youtubeDataApi.ts](../src/pipeline/media/youtubeDataApi.ts).
Which Google account and Cloud project own the key was not checked.

### YouTube push notifications (WebSub)

WebSub is a web standard for push notifications. YouTube publishes through
Google's hub at `https://pubsubhubbub.appspot.com/`. The hub needs no account
and no dashboard. The pipeline subscribes each channel itself, with a 10-day
lease that it renews after 7 days, in
[src/everything/youtubeChannels.ts](../src/everything/youtubeChannels.ts).
Each subscription names the Edge Function's address above and carries
`YOUTUBE_WEBSUB_SECRET`, which the hub uses to sign every notification. If
that secret changes, existing subscriptions keep signing with the old value,
and the function ignores their notifications. Each subscription is renewed 7
days after it was made, the next time the walk reaches its channel.

## Residential proxy

YouTube refuses video requests from datacenter machines. The pipeline sends
those requests through a residential proxy, which routes each connection
through a real person's device. The provider is DataImpulse, paid per
gigabyte, on Jim's account.

The whole proxy address, with its user name and password, is the secret
`YTDLP_PROXY_URL`, in GitHub and on the services machine. Only
[src/pipeline/utils/residentialProxy.ts](../src/pipeline/utils/residentialProxy.ts)
reads it. Changing provider means changing that secret in both places. When
the prepaid traffic runs out, the proxy answers with an error and YouTube
requests fail.

## Browser extension stores

| Store | Listing | Extension ID |
|---|---|---|
| Chrome Web Store | [common-notes](https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij) (version 0.4.0 submitted for review on 2026-10-02, with commonnotes.net as its verified Official URL) | `jodkhmefbcmgldokmeicpdogkepmcnij` |
| Firefox Add-ons (AMO) | [common-notes](https://addons.mozilla.org/en-US/firefox/addon/common-notes/) (public, version 0.4.0, on 2026-10-02) | `extension@commonnotes.net` |
| Safari | no listing yet | |

How to release a new version, and which credentials the store APIs need, is
in [extension-release.md](extension-release.md). Those credentials are
`AMO_JWT_ISSUER` and `AMO_JWT_SECRET` from AMO's API key page, and
`CWS_PUBLISHER_ID` and `CWS_SERVICE_ACCOUNT_KEY_FILE` for a Google Cloud
service account that the Chrome Web Store dashboard grants API access. The Chrome Web
Store publisher ID is `386e874a-cc58-4737-9143-c22ec9085c56`. None of the
four exist yet (2026-10-02). They belong in `~/dev/env/cn-return-bot/env`. Both listings link to
https://commonnotes.net as their homepage.

Microsoft Edge installs from the Chrome Web Store listing. The website's
install buttons link to these listings from
[src/everything-web/src/lib/extensionStores.ts](../src/everything-web/src/lib/extensionStores.ts).

**Never delete the AMO listing.** AMO is addons.mozilla.org, Mozilla's store.
Deleting a listing burns its add-on ID forever. That already happened once to
the first ID, `common-notes@commonnotes.net`. A new ID would also change the
Firefox sign-in address on the redirect allow-list.

Every AMO upload must carry notes for the reviewer and the source code,
because Mozilla's reviewers rebuild the extension and compare the result. Build
the source archive with `git archive`.

The Chrome ID comes from a key pair. The public half is in `wxt.config.ts`.
The private half is the gitignored file `chrome-signing-key.pem`. Keep a
backup of it.

## X developer apps

Two separate X apps exist, in X's developer portal.

1. **The notewriter app.** It acts as the bot's notewriter account to read
   posts, submit notes and read their ratings. Its four credentials are the
   secrets `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN` and
   `X_ACCESS_TOKEN_SECRET`, in GitHub and on the services machine. The code
   that signs requests with them is
   [src/api/getOAuthToken.ts](../src/api/getOAuthToken.ts).
2. **The sign-in app.** It powers "Sign in with X" on the website and in the
   extension. Its key and secret are entered in Supabase under Authentication
   → Sign In / Providers → Twitter. Supabase's "Twitter" provider uses OAuth
   1.0a, the older version of X's sign-in protocol. The app's callback address
   in X's portal must be Supabase's:

   ```
   https://ugytvkevhsmcpunfvncw.supabase.co/auth/v1/callback
   ```

   For local development the same pair goes into `.env` as
   `TWITTER_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_TWITTER_SECRET`, which
   `config.toml` reads.

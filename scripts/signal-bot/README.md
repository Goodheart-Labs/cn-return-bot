Every reply the bot sends starts with “Bot” (plain messages as `Bot: …`, tweet
conversations as `Bot · #n · <tweet id>`), because it may post from the owner's
own Signal account. Tweet links start conversations; exact commands (`yes post`,
`draft`, `cancel`, `#n …`) are matched by the application; any other message
goes to the current conversation, or, with none, gets a plain-language answer
about the bot and its conversations from a chat model that cannot draft or submit.

To use the same engine from a terminal instead of Signal, run
`bun src/signal-bot/main.ts --console [--dry-run]` from a checkout with the
X, OpenRouter, and (live) Supabase variables set. It reads one message per
line, prints replies, keeps its own state file (`output/signal-bot-console*.sqlite`),
and submits approved notes through the same shared X queue as the Signal worker.
Only one console worker can hold that state file at a time.

The Docker worker shares the existing Signal bridge at `127.0.0.1:8080` on the
Linux host. Its Compose project contains only the new notes worker. The gym
bridge and watcher continue under their existing project.

Build from a clean source export containing `package.json`, `bun.lock`, this
directory, and `src/{api,bots,pipeline,signal-bot,utils}`. The Dockerfile-specific
ignore file keeps credentials, local state, and unrelated repository data out of
the build context. Bun is pinned to the version used by the local tests; the
image also installs ffmpeg, yt-dlp, and gallery-dl for media research. It installs
the locked Playwright package's bundled Chromium and OS libraries under
`/ms-playwright`, readable by the runtime `bun` user. An offline browser launch
and a credential-free `--help` check run as that user during the image build.

Prepare `/opt/cn-return-bot/config/signal.env` privately using [`.env.example`](../../.env.example)
and `bun src/signal-bot/main.ts --help`, including the selected requests group and
`SIGNAL_ACCEPT_SELF_MESSAGES=true` when reusing the owner's account. Keep this
file outside the source export, owned by root with mode `0600`. Compose reads
it as raw environment values, without expanding dollar signs in credentials.
Use the same X account and Supabase database as the scheduled pipeline.
`SIGNAL_NUMBER` uses E.164 format; select the notes group's ID from
`GET /v1/groups/<number>` on the bridge.

Create `/opt/cn-return-bot/state` with mode `0700` and owner UID/GID `1000:1000`
(the image's `bun` user). All SQLite state is stored here and survives image
replacement. The group, Signal account, Supabase URL, and dry-run/live mode
must match the state file's existing scope.

The entrypoint holds a kernel file lock in the state directory for the worker's
lifetime. Compose supplies an init process for signal handling and a fixed
hostname for durable worker ownership checks.

After the quota migration and regular-pipeline rollout are complete, build and
start this independent project from the source export:

```sh
docker compose -f scripts/signal-bot/compose.yml build worker
docker compose -f scripts/signal-bot/compose.yml run --rm --no-deps worker --help
docker compose -f scripts/signal-bot/compose.yml up -d --no-deps worker
```

`--help` exits before connecting to Signal, X, or the LLM. Starting the service
begins listening and responding in the configured group. Check service status
with `docker compose -f scripts/signal-bot/compose.yml ps`; startup logs should
show that the worker is listening. Avoid printing the rendered Compose
configuration or environment, which contains credentials.

Use `docker compose -f scripts/signal-bot/compose.yml stop worker` for a graceful
stop. It allows ten minutes to finish accepted messages. A forced stop leaves
pending messages for replay. For an uncertain X submission, stop the worker and
check X's written notes before reconciling `note_submission_claims` and local
SQLite state to the verified outcome, restoring any missing `notes` row.
Preserve draft and approval records; a retry requires a new “yes post”. Never
clear unresolved claims just to free capacity. Preserve the state directory
during every upgrade.

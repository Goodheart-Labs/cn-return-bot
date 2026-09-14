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

Prepare `/opt/cn-return-bot/config/signal.env` privately with the variables listed
in `docs/signal-bot.md`, including the selected requests group and
`SIGNAL_ACCEPT_SELF_MESSAGES=true` when reusing the owner's account. Keep this
file outside the source export, owned by root with mode `0600`. Compose reads
it as raw environment values, without expanding dollar signs in credentials.

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
pending messages for replay and requires reconciliation of any uncertain X
submission, as described in `docs/signal-bot.md`. Preserve the state directory
during every upgrade.

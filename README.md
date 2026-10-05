# Community Notes Writer

Writes sourced Community Notes for X and runs Common Notes for web pages, podcasts,
and videos.

## Setup

Install [Bun](https://bun.sh/) and gitleaks (`brew install gitleaks` on macOS), then:

```sh
bun install
cp .env.example .env
```

Fill in the required credentials in `.env`. Never commit credentials.

## Development

```sh
bun test
bun run check
```

`check` runs the TypeScript checks and unused-code analysis. The pre-commit hook
also scans staged changes for secrets.

To research and draft notes for specific tweets on your computer:

```sh
bun run draft-tweets <tweet-url-or-id> [more-tweets...]
bun run draft-tweets --help
```

This uses the Signal bot's research and drafting process and the standard `X_*`
credentials in your environment. The X app needs access to ordinary tweet lookups;
Community Notes API access alone may not provide that. Configure `OPENROUTER_API_KEY`
for research and `GEMINI_API_KEY` for media analysis. Install the bundled source
verification browser with `bunx playwright install chromium`. The command prints
complete drafts and saves research, warnings, and results
under `output/local-drafts/`. It makes paid API calls, but does not submit notes,
send Signal messages, upload results, or open your default browser. Use
`--output-dir <directory>` to choose where results are saved.

The experimental runner, `bun run src/local/tryoutNotes.ts <tweet-url-or-id>`,
supports replaying saved inputs and forcing experiment variants. It also selects
alternate credentials and uploads results to the review dashboard.

Dashboard commands and builds are in [package.json](package.json).

The [Signal group bot](scripts/signal-bot/README.md) checks pasted tweets, drafts and
discusses notes, and submits the current draft when someone says “yes post”.
Run `bun src/signal-bot/main.ts --help` for local usage and setup requirements.

If the Community Notes account cannot read individual tweets, configure a separate
reader with `X_READ_API_KEY`, `X_READ_API_KEY_SECRET`, `X_READ_ACCESS_TOKEN`, and
`X_READ_ACCESS_TOKEN_SECRET`. Set all four together. Direct tweet lookups use that
reader; Community Notes requests use the standard `X_*` writer keys. A partial
reader configuration fails instead of mixing credentials. The deployed Signal
worker reads its server environment file, so changing your Mac's `.env` alone does
not update the worker.

[CLAUDE.md](CLAUDE.md) covers repository operations, including Common Notes ingestion,
the extension, and the scraper.

## Production

[src/production/runPipeline.ts](src/production/runPipeline.ts) generates and submits
notes. The [Create Notes workflow](.github/workflows/create-notes-routine-dynamic.yml)
is dispatched by Supabase cron. Running the production entry point can submit
real notes; use `draft-tweets` for local research and drafting.

Supabase migrations live in [migrations/](migrations/) and are applied separately.

## License

MIT — see [LICENSE](LICENSE). Third-party content in the repository, including
captured tweets, belongs to its respective authors and is not covered by this license.

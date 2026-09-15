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

To try the note pipeline without submitting to X:

```sh
bun run src/local/tryoutNotes.ts <tweet-url-or-id>
```

This makes paid API calls and writes run results. See the script's flags for
replaying saved inputs and forcing experiment variants.

Dashboard commands and builds are in [package.json](package.json).

The [Signal group bot](scripts/signal-bot/README.md) checks pasted tweets, drafts and
discusses notes, and submits the current draft when someone says “yes post”.
Run `bun src/signal-bot/main.ts --help` for local usage and setup requirements.

[CLAUDE.md](CLAUDE.md) covers repository operations, including Common Notes ingestion,
the extension, and the scraper.

## Production

[src/production/runPipeline.ts](src/production/runPipeline.ts) generates and submits
notes. The [Create Notes workflow](.github/workflows/create-notes-routine-dynamic.yml)
is dispatched by Supabase cron. Running the production entry point can submit
real notes; use the tryout script for development.

Supabase migrations live in [migrations/](migrations/) and are applied separately.

## License

MIT — see [LICENSE](LICENSE). Third-party content in the repository, including
captured tweets, belongs to its respective authors and is not covered by this license.

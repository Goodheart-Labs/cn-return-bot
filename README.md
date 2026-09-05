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
[CLAUDE.md](CLAUDE.md) covers repository operations, including Common Notes ingestion,
the extension, and the scraper.

## Production

[src/production/runPipeline.ts](src/production/runPipeline.ts) generates and submits
notes. The [Create Notes workflow](.github/workflows/create-notes-routine-dynamic.yml)
is dispatched by Supabase cron. Running the production entry point can submit
real notes; use the tryout script for development.

Supabase migrations live in [migrations/](migrations/) and are applied separately.
See [DATABASE.md](docs/DATABASE.md) for database reference and
[community-notes-data.md](docs/community-notes-data.md) for X's public data format.

## License

MIT — see [LICENSE](LICENSE). Third-party content in the repository, including
captured tweets, belongs to its respective authors and is not covered by this license.

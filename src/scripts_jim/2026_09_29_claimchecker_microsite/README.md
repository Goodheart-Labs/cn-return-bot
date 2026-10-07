# Claimchecker lab (GOO-229)

A place to iterate on the Common Notes pipeline with one article. The article is
"AI Safety Is Mostly A Sex Cult In Berkeley, California" by SE Gyges, which the
author deleted on 24 September 2026. We use the Wayback Machine's copy.

Each pipeline run is saved as a file. A local page shows the article with the
notes of any saved run beside their passages, and also the production run of
24 September with the readers' notes and votes.

## Commands

All commands run from the repository root.

```bash
# The microsite, on port 8006. A fresh worktree first needs the extension's
# generated TypeScript config, because the page reuses the extension's anchoring.
(cd src/everything-extension && bunx wxt prepare)
mac-tunnel serve 8006 bunx vite --config $PWD/src/scripts_jim/2026_09_29_claimchecker_microsite/site/vite.config.ts --port 8006 --host 127.0.0.1 --strictPort

# A new run of the pipeline as it is in this branch.
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/runPipeline.ts --label "what changed"

# A run that keeps an earlier run's claims (and ratings), and redoes only the later steps.
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/runPipeline.ts --label "what changed" --from <run id> --reuse extraction
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/runPipeline.ts --label "what changed" --from <run id> --reuse rating

# Refresh the copy of the production run, for example to pick up new votes.
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/snapshotProduction.ts

# Download the archived article again. Only needed if the article file is lost.
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/fetchArticle.ts
```

## Files

- `site/public/article.json` holds the article twice: the cleaned markup the page renders, and the plain text with image markers the pipeline reads.
- `site/public/runs/` holds one file per run and `index.json`, the list the run picker shows.
- `stages/` holds each run's extracted and rated claims, which a later run can reuse.
- `logs/<run id>/<claim>.json` holds the full log of every claim check. It is not committed.

The runner calls the same functions the production services call, in one
process, and writes nothing to the production database.

## The eval datasets

`dataset/` holds the 14 datapoints Jim collected in the GOO-229 comments, for two evals: is the right claim in the extractor's output, and does the claim checker decide right on the claim.

- `datapoints.ts` has the judgement: Jim's group, the expected decision, his words, and the reference claim.
- `buildDataset.ts` reads production (read-only, no model calls) and writes `dataset.json`: the extractor's chunk of the post, the post the checker is handed, and what production did with the claim.
- `buildArtifact.ts` inlines `dataset.json` into `artifact/template.html`, the page published as an artifact.
- `findSnippets.ts` looked up where each snippet of the comments sits in production.

```bash
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/buildDataset.ts
bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/buildArtifact.ts
```

The chunks show images as `[[IMAGE:url]]` markers, because describing them is a model call that has not been done yet.

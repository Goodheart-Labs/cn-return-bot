# Refactor TODOs

## Migrate all bots to PipelineOutcome

Currently only agent and multi-agent return `PipelineOutcome`. Legacy bots (opus-main, opus-bridging, etc.) still return `PipelineResult` directly.

Goal:
- Delete legacy bots
- All bots return `PipelineOutcome`
- Move `outcomeToResult` mapping into `processSingleTweet` (single place, right before DB storage)
- Remove `PipelineResult` construction from bot layer entirely

/**
 * Typed pipeline errors.
 *
 * Throw a `PipelineError` (or subclass) when the bot pipeline fails.
 * `processTweet`'s top-level catch reads `err.outcomeReason` to populate
 * `pipeline_runs.outcome_reason` — so adding a new failure mode is just a
 * subclass with the right reason string.
 *
 * Plain `Error`s thrown anywhere in the pipeline land in `bot_error` (the
 * default on the base class).
 */

export class PipelineError extends Error {
  readonly outcomeReason: string = "bot_error";
}

/** Source verifier couldn't fetch any of the cited URLs — tooling failure,
 * not a substantive verifier rejection. */
export class UnfetchableSourcesError extends PipelineError {
  readonly outcomeReason = "unfetchable_sources";
}

/** LLM returned content that couldn't be parsed as the expected JSON shape. */
export class ModelOutputInvalidError extends PipelineError {
  readonly outcomeReason = "model_output_invalid";
}

/** Multi-agent / agent loop ran out of turns without producing a verdict. */
export class PipelineExhaustedError extends PipelineError {}

/** Agent invoked its `error` tool to signal it gave up. */
export class AgentToolError extends PipelineError {}

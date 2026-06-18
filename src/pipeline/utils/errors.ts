/**
 * Errors thrown from the bot pipeline. The orchestrator's catch reads
 * `err.outcomeReason` to populate `pipeline_runs.outcome_reason`. Plain
 * `Error`s land in `bot_error`; subclass to introduce a new reason.
 */

export class PipelineError extends Error {
  readonly outcomeReason: string = "bot_error";
  constructor(message?: string) {
    super(message);
    // Without this, every stack header reads "Error:" instead of e.g. "ModelOutputInvalidError:".
    this.name = new.target.name;
  }
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

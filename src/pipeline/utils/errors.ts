/**
 * Errors thrown from the bot pipeline. The orchestrator catches them and reads
 * `err.outcomeReason` to fill in `pipeline_runs.outcome_reason`. A plain `Error`
 * carries no such field, so it is recorded as `bot_error`. Add a subclass here
 * when you need a new reason.
 */

export class PipelineError extends Error {
  readonly outcomeReason: string = "bot_error";
  constructor(message?: string) {
    super(message);
    // Without this, every stack header reads "Error:" instead of e.g. "ModelOutputInvalidError:".
    this.name = new.target.name;
  }
}

/** The source verifier could not fetch any of the cited URLs. This is a failure
 * of our fetching tools. It does not mean the verifier judged the sources bad. */
export class UnfetchableSourcesError extends PipelineError {
  readonly outcomeReason = "unfetchable_sources";
}

/** LLM returned content that couldn't be parsed as the expected JSON shape. */
export class ModelOutputInvalidError extends PipelineError {
  readonly outcomeReason = "model_output_invalid";
}

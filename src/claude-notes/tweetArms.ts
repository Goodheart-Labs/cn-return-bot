/* How the picks of the two Claude tweet tests turn into the Claude the runner
 * starts (GOO-838). claude_x_model picks the model and its effort, and
 * claude_x_examples picks whether the 100 example notes go into the system
 * prompt. A tweet whose row has no pick, because the X run drew it before the
 * tests existed, gets the setup that ran before them: Opus at high effort, with
 * the examples. */

import type { ClaudeCommand } from "./runner/session";

type ModelArm = Pick<ClaudeCommand, "model" | "effort">;

export const CLAUDE_X_MODEL_ARMS: Record<string, ModelArm> = {
  opus_high: { model: "opus", effort: "high" },
  opus_medium: { model: "opus", effort: "medium" },
  sonnet_high: { model: "sonnet", effort: "high" },
  sonnet_medium: { model: "sonnet", effort: "medium" },
};
const MODEL_ARM_BEFORE_THE_TEST = "opus_high";
export const WITHOUT_EXAMPLES = "without";

export function tweetModel(picks: Record<string, string>): ModelArm {
  const arm = CLAUDE_X_MODEL_ARMS[picks.claude_x_model ?? MODEL_ARM_BEFORE_THE_TEST];
  if (!arm) throw new Error(`Unknown claude_x_model pick ${picks.claude_x_model}`);
  return arm;
}

export const tweetHasExamples = (picks: Record<string, string>) => picks.claude_x_examples !== WITHOUT_EXAMPLES;

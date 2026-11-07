/** Our own notewriters (GOO-724). The devbox's stand-in for the ai-box runner
 *  uses the same id as the runner, because only one of the two runs at a time. */
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER ?? "claude-ai-box";
export const PIPELINE_NOTEWRITER = "pipeline";

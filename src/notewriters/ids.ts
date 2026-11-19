/** Our own notewriters (GOO-724). A Claude host names its notewriter in
 *  CN_NOTEWRITER: claude-hq-nathan on hq, claude-devbox on the devbox
 *  (GOO-791). The ai-box runner leaves it unset. */
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER || "claude-ai-box";
export const PIPELINE_NOTEWRITER = "pipeline";
/** The notewriters that write on Nathan's main Claude plan, whose usage the
 *  usage pacing reads. The devbox's dispatcher called itself claude-ai-box
 *  until 2026-11-19 and claude-devbox since (GOO-791). The pacing counts the
 *  posts of both, so its usage per post did not start over with the new name. */
export const MAIN_PLAN_NOTEWRITERS = ["claude-ai-box", "claude-devbox"];

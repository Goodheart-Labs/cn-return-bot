/** Our own notewriters (GOO-724). A Claude host names its notewriter in
 *  CN_NOTEWRITER: claude-hq-nathan on hq, claude-devbox on the devbox
 *  (GOO-791). The ai-box runner leaves it unset. */
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER || "claude-ai-box";
export const PIPELINE_NOTEWRITER = "pipeline";

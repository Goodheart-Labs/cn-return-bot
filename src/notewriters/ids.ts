/** Our own notewriters (GOO-724). A Claude host names its notewriter in
 *  CN_NOTEWRITER: claude-hq-nathan on hq (GOO-791). The ai-box runner, Jim's
 *  notewriter, leaves it unset and calls API v2 with its own key. claude-devbox was the devbox's dispatcher,
 *  which GOO-787 removed. */
export const AI_BOX_NOTEWRITER = "claude-ai-box";
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER || AI_BOX_NOTEWRITER;
export const PIPELINE_NOTEWRITER = "pipeline";

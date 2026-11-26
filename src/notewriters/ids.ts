/** Our own notewriters (GOO-724). A Claude host names its notewriter in
 *  CN_NOTEWRITER: claude-hq-nathan on hq (GOO-791). The runner of Jim's
 *  notewriter on its own Claude account leaves it unset and is claude-devbox.
 *  It calls API v2 with claude-devbox's key. From GOO-787 (2026-11-19) until
 *  migration 206 (2026-11-26) it recorded its runs and usage as claude-ai-box,
 *  after Nathan's ai-box it ran on until 2026-11-25; migration 206 renamed
 *  those rows. Before GOO-787, claude-devbox was the devbox's dispatcher on
 *  Jim's main plan, and until 2026-11-19 that dispatcher called itself
 *  claude-ai-box. */
export const RUNNER_NOTEWRITER = "claude-devbox";
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER || RUNNER_NOTEWRITER;
export const PIPELINE_NOTEWRITER = "pipeline";

/** Our own notewriters (GOO-724). A Claude host names its notewriter in
 *  CN_NOTEWRITER: claude-hq-nathan on hq (GOO-791). The runner of Jim's
 *  notewriter on its own Claude account leaves it unset, so its Claude runs and
 *  usage readings carry claude-ai-box, and it calls API v2 with its own key
 *  (GOO-787). Since it moved to the devbox on 2026-11-25, that key is the one
 *  of claude-devbox, so its reservations carry that name. claude-devbox was
 *  first the devbox's dispatcher, which GOO-787 removed. Until 2026-11-19 that
 *  dispatcher called itself claude-ai-box, so the posts claude-ai-box reserved
 *  in the week before the rollout ran on Jim's main plan. */
export const AI_BOX_NOTEWRITER = "claude-ai-box";
export const CLAUDE_NOTEWRITER = process.env.CN_NOTEWRITER || AI_BOX_NOTEWRITER;
export const PIPELINE_NOTEWRITER = "pipeline";

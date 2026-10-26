/** The sidebar sections of the note judge experiment page, in its order. */
export const JUDGE_SECTIONS = ["results", "helpful", "not_helpful", "examples", "judged"] as const;
export type JudgeSection = (typeof JUDGE_SECTIONS)[number];

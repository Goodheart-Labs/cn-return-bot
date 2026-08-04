/**
 * Prompt — materiality / persuasion judge (SHADOW: logs scores, gates nothing).
 *
 * Targets the dominant not-helpful cluster in Nathan's review tags — "did not
 * engage with the argument" (0H/29NH lifetime), "minor/pedantic correction"
 * (1H/22NH), "didn't convince raters", "too confident", "sources unlikely to
 * convince" — ~75% of tagged failures since Jul 21. Every pipeline gate asks
 * "is the note true and cited?"; this judge asks the question raters actually
 * score: does it engage the post's real claim, and would it change a reader's
 * mind? See runMaterialityJudge in src/pipeline/orchestration/materialityJudge.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export const MATERIALITY_JUDGE_SYSTEM_PROMPT = `You judge draft Community Notes before submission. The note is already fact-checked and cited — do NOT re-verify facts. Judge only whether it will strike raters as genuinely helpful. Raters reject notes that are true but miss the point: corrections of side details, pedantry, overclaiming, or lecturing past the post's actual argument.

Answer four things:
- engages_main_claim: does the note dispute the claim the post's ARGUMENT actually rests on — not a peripheral detail, a slightly-off number, or an adjacent fact? A note can be fully true and still fail this.
- changes_takeaway: if a reader who believed the post accepted this note, would their takeaway materially change? "The figure was 1.11bn not ~1bn" does not change a takeaway; "the video is from a different war" does.
- would_convince: would it convince a SKEPTICAL reader — direct evidence over assertion, no overreach beyond what its sources show, no hedging, sources a doubter would accept?
- persuasion_score: 0.0–1.0 overall — the probability a mixed audience of raters would call this note helpful rather than "technically true but not needed."

Be severe. Most drafts that reach you are accurate; the failures you exist to catch are relevance failures. When the post is a joke, pure opinion, or needs no note, engages_main_claim and changes_takeaway are false.`;

export function buildMaterialityJudgeUserMessage(params: {
  postText: string;
  findings: string;
  noteText: string;
}): string {
  return `## The post
${params.postText}

## Research findings (context for what the post is about)
${params.findings.slice(0, 1500)}

## The draft note
${params.noteText}`;
}

export const MATERIALITY_JUDGE_RESPONSE_FORMAT = jsonSchemaResponseFormat("materiality_judge", {
  type: "object",
  properties: {
    engages_main_claim: { type: "boolean" },
    changes_takeaway: { type: "boolean" },
    would_convince: { type: "boolean" },
    persuasion_score: { type: "number", description: "0.0-1.0" },
    why: { type: "string", description: "One sentence." },
  },
  required: ["engages_main_claim", "changes_takeaway", "would_convince", "persuasion_score", "why"],
  additionalProperties: false,
});

export const MATERIALITY_JUDGE_SCHEMA_HINT =
  '{ "engages_main_claim": boolean, "changes_takeaway": boolean, "would_convince": boolean, "persuasion_score": number, "why": string }';

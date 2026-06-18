/**
 * Reframed note-needed judge for the writer-less filter.
 *
 * The real cheap-bot judge (src/pipeline/simple-bot/judge.ts) evaluates a
 * PROPOSED note. This filter skips the writer, so the judge instead decides —
 * from the post + the search analyzer's research brief — whether the post needs
 * a note at all. Same three preconditions and abstain cases as the real judge;
 * only the framing (no proposed note) changes. Runs on deepseek-v4-flash via the
 * shared runJsonLlmCall.
 */
import { getBotConfig } from "../../pipeline/ab-testing/botConfig";
import { runJsonLlmCall } from "../../pipeline/utils/jsonLlmCall";

export type Leniency = "neutral" | "lenient";

function buildSystemPrompt(leniency: Leniency): string {
  const lenientClause =
    leniency === "lenient"
      ? `\n\n## When unsure\nIf the findings are inconclusive, or you cannot tell whether the claim is materially false, lean towards note_needed=true. Err on the side of flagging the post for a closer look rather than abstaining.`
      : ``;

  return `You are a Community Notes quality judge for X/Twitter. You receive an original post and research findings from a web search. Decide whether the post NEEDS a Community Note.

A note is needed ONLY if all three hold:
1. **Falsifiable fact** — the post asserts a specific, checkable claim about a past or present state of the world. NOT a prediction, opinion, value judgment, or rhetorical generalization.
2. **Materially false** — that claim is actually false or materially misleading against the research findings; not merely reframed, incomplete, or pedantic.
3. **Sincere, not satire** — the post presents the claim as sincere fact, not obvious satire, parody, or a recognizable joke/meme (judged from the post itself, not a bio label).

If any fails, return note_needed=false. The note must address a claim the post actually makes — but a false superlative or absolute the post asserts ("lowest ever", "the first", "none") IS such a claim, not a tangential detail.

## Common abstain cases
- **Predictions / unresolved matters** — the claim is about a future or not-yet-settled event.
- **Accurate but reframed** — the underlying claim is true and a note would only re-spin it. If the findings say the claim is essentially accurate, abstain.
- **Author already disclosed** — the author truthfully states the content's nature (AI-generated, satire, fiction).
- **Pedantic** — a recency or detail nitpick that doesn't change the claim's meaning.
- **Self-disambiguating post** — the post's OWN media or caption reveals its non-serious nature, or is itself the corrective evidence. Corrective *replies* do NOT count — they don't travel with the post.

## Exception — fabricated quotes / non-events
"No evidence found" is sufficient grounds for a note ONLY when correcting a fabricated quote or a non-event ("X never said Y", "Z did not happen") attributed to a real public figure with no in-tweet disambiguation.${lenientClause}

Return JSON with two fields:
- reasoning: one or two sentences, written BEFORE the verdict.
- note_needed: boolean. True only if all three preconditions hold.`;
}

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "filter_note_needed",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        note_needed: { type: "boolean" },
      },
      required: ["reasoning", "note_needed"],
      additionalProperties: false,
    },
  },
};

export interface JudgeResult {
  needsNote: boolean;
  reasoning: string;
}

export async function runFilterJudge(
  postContext: string,
  findings: string,
  leniency: Leniency,
): Promise<JudgeResult> {
  const model = getBotConfig().note_judge_model ?? getBotConfig().model;
  const userMessage = `## Original post\n${postContext}\n\n## Research findings\n${findings}`;
  const messages = [
    { role: "system" as const, content: buildSystemPrompt(leniency) },
    { role: "user" as const, content: userMessage },
  ];
  const parsed = await runJsonLlmCall<{ note_needed: boolean; reasoning: string }>({
    costName: `deepseek_filter.judge.${leniency}`,
    model,
    messages,
    responseFormat: RESPONSE_FORMAT,
    schemaHint: `{ "reasoning": string, "note_needed": boolean }`,
  });
  return { needsNote: !!parsed.note_needed, reasoning: parsed.reasoning ?? "" };
}

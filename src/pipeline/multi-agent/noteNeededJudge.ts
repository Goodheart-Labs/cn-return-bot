/**
 * Note Needed Judge
 *
 * Final LLM gate on the multi-agent pipeline. Takes the full tweet context
 * (post text, media, comments, author history) plus the proposed note, and
 * decides whether a Community Note is actually warranted.
 *
 * Broader than the `noteNotNeeded` score — the judge sees everything the
 * researcher saw, not just the tweet text and the note.
 */

import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

export interface NoteNeededJudgment {
  needed: boolean;
  reasoning: string;
}

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "note_needed_judgment",
    strict: true,
    schema: {
      type: "object",
      properties: {
        needed: { type: "boolean", description: "Whether a Community Note is warranted for this post." },
        reasoning: { type: "string", description: "Single-paragraph justification." },
      },
      required: ["needed", "reasoning"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You are the final gate in a Community Notes pipeline. You receive:
- The full context of a post on X/Twitter (text, media, comments, author info)
- Research findings gathered by an earlier agent
- A proposed Community Note that has already passed source verification

Your job: decide whether a Community Note is actually warranted here.

Reject the note (needed=false) when:
- The post is opinion, satire, humor, rhetoric, or hyperbole — not a checkable factual claim
- The "error" is pedantic, trivial, or doesn't change how readers understand the post
- The note corrects a tangential detail while the main claim is fine, or is itself fine
- The comments already make the correction obvious to any reader
- The post is correct, or too ambiguous for a correction to be fair
- The proposed correction doesn't actually disagree with the post in a meaningful way

Accept the note (needed=true) when:
- The post makes a clear factual claim that is misleading or wrong
- The proposed note directly addresses that claim with supporting evidence
- A typical reader would come away with a more accurate understanding after seeing the note

Be strict. A note that shouldn't exist is worse than no note at all.`;

export async function judgeNoteNeeded(params: {
  fullContext: string;
  researcherFindings: string;
  noteText: string;
  sources: string[];
}): Promise<NoteNeededJudgment> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = "noteNeededJudge";

  const userMessage = [
    `## Full post context`,
    params.fullContext,
    ``,
    `## Research findings`,
    params.researcherFindings || "(none)",
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    `## Sources cited by the note`,
    params.sources.length ? params.sources.join("\n") : "(none)",
  ].join("\n");

  log?.set(`${logPrefix}.messages.0`, { systemPrompt: SYSTEM_PROMPT, userMessage });

  try {
    const { response, costEntry } = await trackedLlmCreate(logPrefix, {
      model: config.verifier_model ?? config.model,
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: userMessage },
      ],
      response_format: RESPONSE_FORMAT,
    } as any);
    trackLlmCall(costEntry);

    const content = response.choices?.[0]?.message?.content ?? "{}";
    const result: NoteNeededJudgment = JSON.parse(content);

    log?.set(`${logPrefix}.messages.1`, { content: result });
    return result;
  } catch (err: any) {
    const fallback: NoteNeededJudgment = {
      needed: true,
      reasoning: `Judge failed, defaulting to accept: ${err.message}`,
    };
    log?.set(`${logPrefix}.messages.1`, { content: fallback });
    return fallback;
  }
}

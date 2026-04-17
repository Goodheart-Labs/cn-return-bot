/**
 * Note Needed Judge
 *
 * Single LLM call that decides whether a tweet warrants a Community Note,
 * given the original post context and the researcher's findings.
 *
 * Separating this concern lets the researcher focus on finding evidence and
 * the notewriter focus on phrasing — neither has to reason about the yes/no
 * decision themselves.
 */

import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

export interface NoteNeededDecision {
  needed: boolean;
  reason: string;
}

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "note_needed_decision",
    strict: true,
    schema: {
      type: "object",
      properties: {
        needed: {
          type: "boolean",
          description: "True if the post warrants a Community Note correction.",
        },
        reason: {
          type: "string",
          description: "One or two sentences explaining the decision.",
        },
      },
      required: ["needed", "reason"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You are the note-needed judge in a Community Notes pipeline for X/Twitter.

You receive:
1. The original post (with author, media, comments, etc.)
2. A researcher's findings about the post's factual claims

Your single job: decide whether the post warrants a Community Note correction.

## Say a note IS needed when
- The post makes a clear factual claim that the research findings directly contradict with credible evidence.
- The post is likely to leave readers with a materially less accurate understanding of reality ("the map and the territory").
- The research surfaces a specific, verifiable fact (with a real source) that corrects a misleading claim.

## Say a note is NOT needed when
- The post is opinion, satire, a joke, hyperbole, or clearly subjective.
- The post is factually correct, or the research did not surface contradicting evidence.
- The "error" is pedantic, minor, or a matter of interpretation.
- The researcher's findings are vague, speculative, or rely on weak/missing sources.
- The post is ambiguous and a reasonable reader would not be misled.

Most posts do NOT need a note. Default to "not needed" unless the evidence for a correction is clear and strong.

Respond in JSON with { needed, reason }. Keep the reason to one or two sentences.`;

export async function judgeNoteNeeded(params: {
  postUserMessage: string;
  researcherFindings: string;
}): Promise<NoteNeededDecision> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = `multiAgent.noteNeededJudge.messages`;

  const userMessage = [
    `## Original post context`,
    params.postUserMessage,
    ``,
    `## Researcher findings`,
    params.researcherFindings,
  ].join("\n");

  log?.set(`${logPrefix}.0`, { systemPrompt: SYSTEM_PROMPT, userMessage });

  try {
    const { response, costEntry } = await trackedLlmCreate(`noteNeededJudge`, {
      model: config.model,
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: userMessage },
      ],
      response_format: RESPONSE_FORMAT,
    } as any);
    trackLlmCall(costEntry);

    const content = response.choices?.[0]?.message?.content ?? "{}";
    const decision: NoteNeededDecision = JSON.parse(content);

    log?.set(`${logPrefix}.1`, { content: decision });
    return decision;
  } catch (err: any) {
    const fallback: NoteNeededDecision = {
      needed: false,
      reason: `Judge failed: ${err.message}`,
    };
    log?.set(`${logPrefix}.1`, { content: fallback });
    return fallback;
  }
}

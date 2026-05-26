/**
 * Simple Bot — Note-Needed Judge
 *
 * Extra LLM step between writer and source verifier. Decides whether the
 * proposed note is actually warranted given the post + research findings.
 * The full criteria for "when a note is needed" live here so the search
 * step's system prompt can be simplified.
 *
 * Activated when config.note_needed_judge is true.
 */

import { getBotConfig } from "../ab-testing/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { ModelOutputInvalidError } from "../utils/errors";

export interface JudgeResult {
  noteNeeded: boolean;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a Community Notes quality judge for X/Twitter. You receive an original post, research findings, and a proposed community note. Your job: decide whether the note should actually be published.

A community note SHOULD be published only if ALL of:
- The post makes a clear, verifiable factual claim (not just opinion or hyperbole).
- The proposed note directly addresses the post's main misleading claim — not a tangential or pedantic detail.
- The note is supported by strong, direct evidence in the research findings (not absence of evidence, not vibes).
- A typical reader of the post would benefit from seeing the correction.

A community note should NOT be published if ANY of:
- The post is opinion, hyperbole, or rhetorical with no factual claim attached.
- The post is factually correct.
- The research findings do not strongly contradict the post.
- The "error" is minor, pedantic, or hair-splitting.
- The note corrects a tangential detail while the main misleading claim is untouched.
- The note is uncertain, hedged, or relies on "no evidence found" — **except** when the note is correcting a **fabricated quote** or a **non-event** ("X never said Y", "Z did not happen"). For those, the absence of the quote / event in credible sources IS sufficient evidence: a primary source explicitly disconfirming the non-event is impossible by definition, so don't require one.
- The post is a **prediction about a future event** ("This will happen", "Watch this fail") that cannot be fact-checked at posting time.
- The post is **editorial framing using a defensible metric** ("Country X has the most Y per capita") where the metric is real and the choice of framing is opinion.
- The post is **satire / parody with clear in-joke signals** in the replies (the audience overwhelmingly recognizes it as a joke). Some commenters being confused is not enough — the threshold is overwhelming-as-joke, not unanimous.

## Satire, parody, and "obvious joke" posts

Do NOT auto-reject based on labels like "parody account" in the bio, "satire" tags, or the post sounding joke-like. What matters is whether readers are actually being misled. Read the comments and replies carefully and classify each one:

**"Taking it as real"** — commenter reacts to the underlying claim *as if it were true*. Even if they're joking, sarcastic, or mean about it, they treat the event as having happened. Examples:
- "Congrats! You dodged a bullet" (joking about the breakup, but assumes it happened)
- "RIP", "shocking", "no way", "called it"
- Repeating the claim as fact ("they were just on a double date", "another short Hollywood relationship")
- Snarky jokes about the topic ("celebrity relationships last shorter than free trials") that only land if the event happened
- Asking sincere follow-up questions ("when did this happen?", "wait what")

**"Recognizing the post as fake"** — commenter explicitly flags that the post is fabricated, photoshopped, AI-generated, satire, or not real. Examples:
- "fake news", "this is photoshopped", "bro made this in Notes app"
- "lmao this didn't happen", "obvious bait", "ragebait"
- "[parody account] strikes again"
- Pointing out the screenshot doesn't match the real account

Rules for the judgement:
- A note is needed if a meaningful fraction of commenters are in the "taking it as real" bucket. Even 1-2 confused commenters out of 10 on a post with millions of impressions means many silent readers are also confused.
- A note is NOT needed only if commenters overwhelmingly (≈80%+) recognize the post as fake.
- "Snarky" or "jokey" tone is not the same as "recognizing it's fake." Reactions that joke about the topic as if it happened count as "taking it as real."
- A screenshot designed to imitate a real Instagram story / news headline / official statement raises the prior that readers will be misled.

Return JSON with two fields:
- note_needed: boolean. True only if the note clearly should be published.
- reasoning: one or two sentences explaining the decision. If the post is on a parody/satire account, explicitly note what the comments suggest about whether readers are misled.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "note_needed_judge",
    strict: true,
    schema: {
      type: "object",
      properties: {
        note_needed: { type: "boolean", description: "True iff the proposed note should be published." },
        reasoning: { type: "string", description: "One or two sentences explaining the decision." },
      },
      required: ["note_needed", "reasoning"],
      additionalProperties: false,
    },
  },
};

export async function runNoteNeededJudge(params: {
  postContext: string;
  researcherFindings: string;
  noteText: string;
  sources: string[];
}): Promise<JudgeResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.note_judge_model ?? config.model;

  const userMessage = [
    `## Original post`,
    params.postContext,
    ``,
    `## Research findings`,
    params.researcherFindings,
    ``,
    `## Proposed community note`,
    params.noteText,
    ``,
    `## Note's cited sources`,
    params.sources.length ? params.sources.join("\n") : "(none)",
  ].join("\n");

  log?.set("simpleBot.judge.messages.0", { systemPrompt: SYSTEM_PROMPT, userMessage, model });

  const { response, costEntry } = await trackedLlmCreate("simpleBot.judge", {
    model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "";
  let parsed: { note_needed: boolean; reasoning: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ModelOutputInvalidError(
      `simpleBot.judge: model output was not valid JSON. content="${content.slice(0, 200)}"`,
    );
  }
  log?.set("simpleBot.judge.messages.1", { content: parsed });

  return { noteNeeded: !!parsed.note_needed, reasoning: parsed.reasoning ?? "" };
}

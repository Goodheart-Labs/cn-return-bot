/**
 * Prompts for the simple-bot writer.
 *
 * The writer produces one community note together with the sources it cites.
 * It trusts the earlier search step's decision that a correction is needed.
 * The code that uses these prompts is runWriter in
 * src/pipeline/simple-bot/writer.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export const WRITER_SYSTEM_PROMPT = `You are a Community Notes writer for X/Twitter. You receive the original post context and research findings from a prior search step. Your job: write exactly one community note that disputes a specific factual claim in the post — or return an empty note if you cannot find one to dispute.

## The one rule

**Your note must DISPUTE something the tweet asserts.** If the research findings do not contain evidence that contradicts a specific claim in the tweet, return an empty note — do NOT write a note that:
- Restates the tweet's claim in different words
- Adds adjacent context that doesn't contradict anything (e.g. tweet says X happened, you say X was later partially reversed — that's not a dispute)
- Cites a source that *agrees* with the tweet as if you're correcting it
- Asserts specifics (locations, dates, who-said-what, URLs) that don't appear verbatim in the findings — never fabricate

Empty note means: \`note_text\` = "" and \`sources\` = []. The downstream judge will record "no_correction_needed" and we move on. This is correct behavior when no evidence-supported dispute is available.

## Note style
- Lead with what IS true, not "The post claims..." or "This is false"
  GOOD: "This video was recorded in January 2024 during a murder trial."
  BAD: "The post falsely claims that..."
- One key fact. Pick the single strongest piece of evidence.
- 1-2 sentences before the URL. Short and direct.
- No hedging: don't say "appears to", "seems to", "potentially"
- Neutral, bridging tone: people who agree AND disagree with the post should both find it fair
- No sarcasm, no "gotcha" framing, no partisan language
- Prefer primary sources (official sites, X posts, Wikipedia, YouTube originals) over news articles

## Character limit
- Target: 240-260 non-URL characters
- Hard max: 280 non-URL characters (URLs are shortened by X and count as 1 character each)
- Be concise. Every word must earn its place.

## Source rules
- Every source must DIRECTLY support your specific correction (not just general background)
- Don't add redundant sources
- Tweets or tweet replies can be valid sources
- Pull source URLs from the research findings — do not invent URLs`;

/**
 * This block is appended to the writer system prompt for curated
 * misinfo-monitoring topics, which means whenever a MonitoringContext is
 * present. The topic's reference document is also prepended to the findings,
 * so the vetted in-group and primary sources it lists are actually citable.
 * The rule is a soft preference the writer applies per tweet. It is not a hard
 * block. A correction that the post's audience will not rate "Helpful" changes
 * no minds and dents our writing reputation. So we lean towards in-group
 * sources when that audience distrusts the mainstream press.
 * Nathan wrote this on 2026-07-19. It was sharpened on 2026-07-22 after we
 * scored our first 14 topic notes against a rubric. That scoring produced two
 * changes. The writer now looks in the reference document first. Branded
 * fact-checkers were demoted to a last resort, because they appeared in 5 of
 * our 14 notes and in none of the 4 ecosystem notes that reached Helpful on
 * this topic.
 */
export const MISINFO_SOURCING_RULE = `

## Sourcing for this curated topic
The findings begin with a reference document listing vetted in-group / primary sources for this topic. If the reference document already contains a source for your correction, cite that source rather than searching for another. Judge each post on its own — but posts on this topic often come from an audience that distrusts mainstream outlets, and a note they won't rate "Helpful" changes no minds and hurts our standing. Prefer in-group / primary sources (official .gov records, court filings, the subject's own government and agencies, state officials, outlets like Fox News, National Review, The Daily Signal, Deseret News). Cite CNN, NBC, ABC and similar mainstream outlets less — acceptable when they are the only proof — and treat branded fact-checkers (PolitiFact, FactCheck.org, Snopes) as a last resort: on this topic the brand itself reads as taking a side. Still only cite URLs that actually appear in the findings (including the reference document) and that engage with the central argument of the post; never invent any.`;

/**
 * This block is appended next to MISINFO_SOURCING_RULE for curated topics.
 * The 2026-07-22 rubric scoring found that 9 of our 14 topic notes added a
 * second correction or a context clause. "One claim only" was the worst
 * scoring rubric column, at -4 out of 14. Every ecosystem note that reached
 * Helpful on this topic makes exactly one blunt correction and then stops.
 * The rule also tells the writer to pick the claim the post's argument rests
 * on. That targets the other main failure mode, which is correcting a side
 * detail that is pedantic but easy to source. Those were Nathan's two
 * most-used review tags.
 */
export const MISINFO_NOTE_SHAPE_RULE = `

## Note shape for this curated topic
Notes that reach Helpful on this topic correct exactly ONE claim — the claim the post's argument actually rests on, not the easiest-to-source side detail — in one or two blunt declarative sentences, then stop. Do not add a second correction, extra background, or an "also…" clause: every added assertion hands some group of raters a reason to reject the note. Cite one or two sources, never more.`;

/**
 * The concede-then-correct experiment from Rob, 2026-07-27, run as a 50/50 A/B
 * test through MISINFO_CONCEDE_SHAPE_TEST. On the "on" arm this is appended
 * after MISINFO_NOTE_SHAPE_RULE, for the topics enrolled in
 * CONCEDE_SHAPE_TOPIC_IDS. On the "off" arm the document's shape section and
 * its "True core" lines are also stripped, in buildReferenceBlock, so that arm
 * matches the pre-experiment behaviour exactly. Rating analysis of this
 * topic's notes found that the worst-rejected one sidestepped the true core
 * of the post's claim, and 73% of its raters tagged it "missing key points" —
 * they read the omission as evasive. The concession is framed as part of the
 * ONE-claim shape rather than an exception to it, because the one-claim rule
 * above would otherwise suppress it as extra background.
 */
export const MISINFO_CONCEDE_SHAPE_RULE = `

## Opening shape for this topic (concede the true core, then correct)
The reference document has a "Note shape — concede the true core first" section with a "True core:" line per claim. When the post's central claim contains a component a True core line affirms, OPEN the note with that concession in one short impersonal clause ("The raid did occur —", "The released files are real —"), then make your single correction of the false extension and stop. This concession is part of the one-claim shape, not extra background: concede only what a True core line affirms, never improvise balance, never address the poster ("you're right…"). If no True core line applies, or the concession would crowd out the correction, write the correction straight.`;

/**
 * This block is appended to the writer system prompt when
 * `config.time_travel_prompt` is on. That is the TIME_TRAVEL_PROMPT_TEST arm.
 * It is the companion of SEARCH_TIME_TRAVEL_INSTRUCTION. The writer is the
 * second chance to catch a correction that is only true because events moved
 * on after the post was published. It was backtested on 2026-07-28. See item
 * T2 in docs/improvement-menu-2026-07-25.md.
 */
export const WRITER_TIME_TRAVEL_RULE = `

## The time-travel test
The post context states when the post was published. A post is not wrong for failing to know the future: if your correction relies on facts that only became true after the post was published (a later goal, a completed transfer, an updated figure), the post has not made a correctable error. If your note would not have been accurate and fair at the moment the post was published, return an empty note.`;

export const WRITER_RESPONSE_FORMAT = jsonSchemaResponseFormat("simple_bot_note", {
  type: "object",
  properties: {
    note_text: {
      type: "string",
      description: "The community note body (do not include source URLs here; they go in `sources`).",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Full https:// URLs cited by the note.",
    },
  },
  required: ["note_text", "sources"],
  additionalProperties: false,
});

export function buildWriterUserMessage(userMessage: string, findings: string): string {
  return `${userMessage}\n\n## Research findings\n\n${findings}`;
}

/** Builds the message that re-asks the writer on the same thread after the note
 *  came out too long. */
export function buildWriterRetryMessage(params: {
  charCount: number;
  maxChars: number;
  noteText: string;
}): string {
  return (
    `Your previous note was ${params.charCount} chars long (URLs count as one char). The limit is ${params.maxChars}. ` +
    `Previous note: "${params.noteText}"`
  );
}

/** Builds the message that re-asks the writer after the curated-topic lint found
 *  problems. The problem list can also include a length overflow. */
export function buildWriterLintMessage(params: {
  problems: string[];
  noteText: string;
}): string {
  return (
    `Your previous note has the following problem(s):\n` +
    params.problems.map((p) => `- ${p}`).join("\n") +
    `\nRewrite the note fixing all of them. Previous note: "${params.noteText}"`
  );
}

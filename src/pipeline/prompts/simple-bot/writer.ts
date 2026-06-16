/**
 * Prompt — simple-bot writer.
 *
 * Produces one community note + cited sources, trusting the upstream search
 * decision that a correction is needed. See runWriter in
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

/** Maximally-terse variant (SIMPLE_BOT_PROMPTS_TEST = simple). */
export const SIMPLE_WRITER_SYSTEM_PROMPT = `Write one X Community Note that disputes a specific false claim in the post, using the research findings. If nothing in the findings contradicts a claim, return an empty note (note_text "" and sources []).

Lead with the true fact. Max 280 non-URL characters. Neutral, non-partisan tone. Cite only URLs that appear in the findings — never invent any.

Return JSON: { note_text, sources }.`;

/**
 * Few-shot block appended to the writer system prompt when
 * `config.writer_examples` is on (SIMPLE_BOT_WRITER_EXAMPLES_TEST). Real notes
 * that performed well — picked because they are simple, direct, and far shorter
 * than the limit. Each example shows the full post context the writer saw
 * (tweet text, any quoted tweet, any media description — genuine tweet text +
 * Gemini media analysis, fetched via fetchTweetById + analyzeMediaGemini).
 * `note_text` excludes the URLs (they live in `sources`), matching the writer's
 * output schema.
 */
export const WRITER_FEWSHOT_EXAMPLES = `

## Examples of the target style
### Example 1
Tweet: The tiger is saved by the elephant during the flood
Media Description: A tiger is seen climbing onto the back of an elephant that is wading through a fast-flowing, muddy river. The scene is set against a backdrop of lush green trees and misty hills.
{ "note_text": "This is an AI generated video.", "sources": ["https://www.foolproofme.org/articles/975-how-to-recognize-ai-generated-images-and-videos-artificial-intelligence"] }

### Example 2
Tweet: Man claimed a wolf saved his life after he passed out in his yard, but nobody believed him until police saw the footage. The man had been cutting wood outside his home when one swing landed wrong and the axe nicked his leg. It wasn't a deep cut, but it was enough to scare him.
Media Description: A two-panel image depicting a wolf attack and its aftermath. The top panel, captured by a security camera on April 22, 2024, at 19:21:55, shows a man lying face down on the grass while a wolf-like animal stands over him, howling. The bottom panel shows body-worn camera footage from approximately 40 minutes later, showing emergency responders and a police officer treating the man, who has a bloody and bandaged leg.
{ "note_text": "There is no evidence this event occurred. The images and story follow a documented pattern of AI-generated \\"emotional animal rescue\\" fictions.", "sources": ["https://leadstories.com/hoax-alert/2026/05/fact-check-fake-video-shows-person-rescuing-a-submerged-wolf-that-was-trapped-under-ice.html", "https://www.snopes.com/collections/2025-ai-slop-rumors/"] }

### Example 3
Tweet: Drivers with 8 titles. - Sir Lewis Hamilton. - Jarno Opmeer. End of list. 🐐
Quoted Tweet: @jarno_opmeer becomes the first driver in PSGL history to win eight top tier titles. A big congratulations to the @redbullsimrace driver. #PSGLS40
Media Description: A 2x2 grid of racing personalities — a blonde sim racer (left panels, one with a headset and team jersey) and Formula 1 driver Lewis Hamilton (right panels: in racing gear with a rainbow helmet celebrating, and on a podium holding a trophy with Max Verstappen behind him).
Quoted Media Description: A celebratory graphic for Jarno Opmeer, champion of PSGL PC F1 Season 40, pointing upward in victory with fireworks behind him and eight trophy icons along the bottom.
{ "note_text": "Lewis Hamilton has 7 Formula 1 titles.", "sources": ["https://es.wikipedia.org/wiki/Lewis_Hamilton"] }

### Example 4
Tweet: 25% of Walmart's revenue comes from SNAP
Media Description: A film still from 'No Country for Old Men' showing Anton Chigurh standing inside a small general store, looking toward someone off-camera, with shelves of merchandise and a snack rack behind him.
{ "note_text": "Walmart captures 25% of SNAP, which accounts for 3.5% of its revenue.", "sources": ["https://www.supermarketnews.com/grocery-trends-data/walmart-brings-in-the-most-snap-dollars-some-25-of-all-sales"] }

### Example 5
Tweet: Nintendo LOST the palworld lawsuit lets GOOOOOOOOOOOOOO
{ "note_text": "Nintendo has not lost the Palworld patent lawsuit. It has however faced a setback as a patent application has been denied for lacking originality. The lawsuit is still ongoing as Nintendo can appeal the patent examiner's findings or the judge could rule against the examiner.", "sources": ["https://www.windowscentral.com/gaming/nintendos-palworld-case-japan-patent-office-rejects-claim-not-original-enough"] }`;

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

/** Re-ask the writer on the same thread after a length overflow. */
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

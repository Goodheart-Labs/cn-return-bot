/**
 * Claude Simple — Writer
 *
 * Single LLM call that produces one community note + its cited sources. The
 * writer trusts the upstream search decision that a correction IS needed; it
 * does not re-check that here.
 */

import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

export interface WriterResult {
  noteText: string;
  sources: string[];
}

const SYSTEM_PROMPT = `You are a Community Notes writer for X/Twitter. You receive the original post context and research findings from a prior search step, and you write exactly one community note.

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
- Hard max: 275 non-URL characters (URLs are shortened by X and count as 1 character each)
- Be concise. Every word must earn its place.

## Source rules
- Every source must DIRECTLY support your specific correction (not just general background)
- Don't add redundant sources
- Tweets or tweet replies can be valid sources
- Pull source URLs from the research findings — do not invent URLs`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "claude_simple_note",
    strict: true,
    schema: {
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
    },
  },
};

export async function runWriter(userMessage: string, findings: string): Promise<WriterResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = "claudeSimple.writer.messages";

  const combinedUserMessage = `${userMessage}\n\n## Research findings\n\n${findings}`;

  log?.set(`${logPrefix}.0`, { systemPrompt: SYSTEM_PROMPT, userMessage: combinedUserMessage });

  const { response, costEntry } = await trackedLlmCreate("claudeSimple.writer", {
    model: config.writer_model ?? config.model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: combinedUserMessage },
    ],
    response_format: RESPONSE_FORMAT,
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { note_text: string; sources: string[] };

  log?.set(`${logPrefix}.1`, { content: parsed });

  return { noteText: parsed.note_text, sources: parsed.sources };
}

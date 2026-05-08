/**
 * Simple Bot — Writer
 *
 * Single LLM call that produces one community note + its cited sources. The
 * writer trusts the upstream search decision that a correction IS needed; it
 * does not re-check that here.
 */

import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { countNoteLength } from "../write/writeNote";

export interface WriterResult {
  noteText: string;
  sources: string[];
}

const MAX_WRITER_ATTEMPTS = 3;
const MAX_NOTE_CHARS = 280;

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
- Hard max: 280 non-URL characters (URLs are shortened by X and count as 1 character each)
- Be concise. Every word must earn its place.

## Source rules
- Every source must DIRECTLY support your specific correction (not just general background)
- Don't add redundant sources
- Tweets or tweet replies can be valid sources
- Pull source URLs from the research findings — do not invent URLs`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "simple_bot_note",
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
  const combinedUserMessage = `${userMessage}\n\n## Research findings\n\n${findings}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: combinedUserMessage },
  ];

  for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
    const logPrefix = `simpleBot.writer.attempts.${attempt - 1}`;
    log?.set(`${logPrefix}.messages`, messages);

    const { response, costEntry } = await trackedLlmCreate(`simpleBot.writer.${attempt}`, {
      model: config.writer_model ?? config.model,
      messages,
      response_format: RESPONSE_FORMAT,
    } as any);
    trackLlmCall(costEntry);

    const content = response.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { note_text: string; sources: string[] };
    const charCount = countNoteLength(parsed.note_text);

    log?.set(`${logPrefix}.response`, parsed);
    log?.set(`${logPrefix}.charCount`, charCount);

    if (charCount <= MAX_NOTE_CHARS) {
      return { noteText: parsed.note_text, sources: parsed.sources };
    }

    if (attempt >= MAX_WRITER_ATTEMPTS) {
      throw new Error(
        `simple-bot writer exceeded ${MAX_NOTE_CHARS} char limit after ${MAX_WRITER_ATTEMPTS} attempts (last: ${charCount} chars)`,
      );
    }

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content:
        `Your previous note was ${charCount} characters (URLs count as 1 each), but the hard max is ${MAX_NOTE_CHARS}. ` +
        `Rewrite the note shorter while keeping the same correction and sources. Previous note: "${parsed.note_text}"`,
    });
  }

  throw new Error("unreachable");
}

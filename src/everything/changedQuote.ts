/* Whether a post still says the passage a note quotes, and what it says there
 * now (migration 200). The comparison is between two readings of the same
 * post by the same reader: the text stored when the post was checked, and the
 * text as it reads today. */

const PLAIN: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-" };
const SKIPPED = /[\s*_[\]]/;

/** How much of the stored text on either side of the passage must be found
 *  in the post as it reads now. */
const ANCHOR_CHARS = 150;
/** An anchor shorter than this could match by chance. */
const MIN_ANCHOR_CHARS = 40;

/** A text as compared: lower case, quotes and dashes plain, and without
 *  whitespace, emphasis marks or square brackets, so a passage that runs across a line
 *  break still matches. `at[i]` is where character i of `text`
 *  sits in `raw`. */
interface Squashed {
  raw: string;
  text: string;
  at: number[];
}

function squash(input: string): Squashed {
  const raw = input.normalize("NFKC");
  const chars: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (SKIPPED.test(char)) continue;
    for (const lower of (PLAIN[char] ?? char).toLowerCase()) {
      chars.push(lower);
      at.push(i);
    }
  }
  return { raw, text: chars.join(""), at };
}

/** What became of a quoted passage.
 *  - `not_in_stored`: the note quotes the post loosely, so nothing can be said.
 *  - `still_there`: the post says it as before.
 *  - `cut_off`: the post as it reads now does not go on past the passage, as
 *    behind a paywall. That is not a change.
 *  - `rewritten`: the passage is gone and so is the text around it, so what
 *    replaced it cannot be told apart from its surroundings.
 *  - `removed`: the text around the passage is still there, with nothing
 *    between.
 *  - `changed`: the text around the passage is still there, and `nowReads`
 *    stands where the passage stood. */
export type QuoteVerdict =
  | { kind: "not_in_stored" | "still_there" | "cut_off" | "rewritten" | "removed" }
  | { kind: "changed"; nowReads: string };

export function compareQuote(quote: string, storedText: string, liveText: string): QuoteVerdict {
  const passage = squash(quote).text;
  const stored = squash(storedText).text;
  const live = squash(liveText);
  const start = stored.indexOf(passage);
  if (passage.length < 20 || start < 0) return { kind: "not_in_stored" };
  if (live.text.includes(passage)) return { kind: "still_there" };

  const before = stored.slice(Math.max(0, start - ANCHOR_CHARS), start);
  const rest = stored.slice(start + passage.length);
  const after = rest.slice(0, ANCHOR_CHARS);
  const beforeAt = before.length >= MIN_ANCHOR_CHARS ? live.text.indexOf(before) : -1;
  const from = beforeAt < 0 ? -1 : beforeAt + before.length;
  // Both sides must be found. A passage that opens or ends a post has only
  // one, and then a post cut off there (a paywall, a teaser) could not be told
  // from a change, so it is never called changed.
  const to = after.length >= MIN_ANCHOR_CHARS ? live.text.indexOf(after, Math.max(from, 0)) : -1;

  if (to < 0) {
    const later = [300, 1000, Math.max(0, rest.length - ANCHOR_CHARS)].map((offset) => rest.slice(offset, offset + ANCHOR_CHARS));
    const readsOn = later.some((chunk) => chunk.length >= MIN_ANCHOR_CHARS && live.text.includes(chunk));
    return { kind: readsOn ? "rewritten" : "cut_off" };
  }
  if (from < 0 || to - from > passage.length * 4 + 300) return { kind: "rewritten" };
  if (to === from) return { kind: "removed" };
  const nowReads = live.raw.slice(live.at[from]!, to < live.at.length ? live.at[to]! : live.raw.length).trim();
  return { kind: "changed", nowReads };
}

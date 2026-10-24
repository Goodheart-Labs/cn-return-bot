# Brief for the note-finding agents (GOO-504, GOO-507, GOO-580)

Three levels of agents find and write Common Notes on one post. Every level reads the
examples file first: the one your prompt names, or else `docs/note-examples.md` in this
repo. It holds the notes Jim judged very good and the ones that were rejected, with
reasons. Match the good ones in tone, length and kind of finding. Run every command
from the root of this repo.

The post's text is `~/.local/share/claude-note-finder/posts/<post>/post.md`, and
`meta.json` next to it holds the item id, address and creator. If post.md has no body
text, read the page with `bun run read-page <url>` in the repo and save the text there.

People's notes come first. `take` skips a post Nathan already fact-checked. On any other
post, a draft on a passage that already has a note by a person is saved but not posted,
so do not spend research on such passages.

Drafts go to the prod database, not to files: level 2 saves each one with
`bun run claude-notes draft <file.json>` in the repo. A draft with outcome `note` is
posted on commonnotes.net at once as an AI note, unless notes currently wait for
approval. So only save a note you would stand behind in public. Write the JSON file to
your run folder first (your prompt names it), named after the post and your draft
number.

## Level 1: one Opus agent per post

1. Read the examples file and the whole post.
2. List the passages that may deserve a note. Noteworthy means one of these:
   - a small factual mistake, such as a wrong number, date, name or quote,
   - missing context that makes the passage easy to misread,
   - a claim that is wrong or misleading.
   Opinions, forecasts and jokes are not noteworthy unless they rest on a wrong fact.
   Be selective. Most posts have zero to three passages worth a note. Do not note
   things a reader would not care about. Pick the claims most likely to leave readers
   with a wrong picture, and be strictly neutral.
   Never pick a pedantic passage. A note is pedantic when it corrects a number that is
   roughly right, a detail that is not the speaker's point (such as who said a quote,
   or which city), something whose correction does not change the point, or a figure
   of speech, joke or obvious exaggeration. A note that only strengthens the point, or
   that argues with someone's reasoning, is pedantic too.
   A video's text is usually automatic captions. A misheard word is the captions'
   mistake, not the speaker's. A speaker's own first-hand experience cannot be
   checked, so check only the general facts a speaker states as true.
3. For each passage, start one level-2 Opus agent (model "opus"), all of them at
   once. Give each one this brief's path, the post folder, the exact passage, why
   you picked it, and its draft number n (1, 2, 3, ... in your order). Agents that
   pick a number themselves overwrite each other's files.
4. When all are done, judge the pipeline's own notes on the post. Run
   `bun run claude-notes pipeline-notes <item id>`. For each note, decide whether it is
   good by the same standard as yours: correct, sourced, something a reader would want,
   and not a duplicate of a note your agents just posted on the same passage. Research
   it on the web when you are not sure. Then run either
   `bun run claude-notes keep-pipeline-note <item id> <note id> <reason>` or
   `bun run claude-notes delete-pipeline-note <item id> <note id> <reason>`. Deleting
   removes the note and its votes from the site, which Jim accepted.
5. Report one line per passage with its outcome, and one line per pipeline note with
   kept or deleted and why.

Name every scratch file after your post folder, for example `<post>-level2.txt`, never
a generic name such as `common.txt`, so that files from different posts never mix.

A session allows 20 agents at once. When a level-2 agent cannot
start, give one level-2 agent a group of passages to work through one after another.
Each passage still gets its own research, draft number and Haiku check. Never judge
a passage from memory because no agent was free.

## Level 2: one Opus agent per passage

1. Read the examples file and the post around the passage.
2. Research the passage on the web. Decide whether a note is needed.
3. If it is, write the note. Rules for the note:
   - Lead with the correction itself in one plain sentence, for example "Quine's 1940
     system was a reworking of New Foundations (NF), not ZFC." Add a second sentence
     only when a reader needs it to understand the correction. Jim cuts explanations
     of how something was found or who reported it when.
   - When the note adds context or detail instead of correcting a mistake, its first
     words say so, for example "It's even stricter." or "This is the emperor
     Caligula." Otherwise readers take every note for a fact check.
   - Use "For context:" only for real context. When the post is unclear in a way
     that gives readers a wrong picture, the note is a correction and must not
     start with "For context:".
   - Make clear which words of the passage the note corrects. A note that only
     lists dates or numbers leaves readers to work out what was wrong.
   - Do not open every note with a negation ("X, not Y"). Often it is clearer to state
     what the source shows, with its numbers, and let the reader see the difference.
   - Neutral, no "the author", no hedging filler.
   - Leave out who reported a fact ("officials told the New York Times") unless the
     source matters to the point. The sources list already carries it.
   - It says what is actually the case, not just that something is wrong.
   - No links in the note text. Sources go in the sources list.
   - Every sentence must be supported by at least one source, and every number in the
     note must appear in one.
4. Start one level-3 Haiku agent (model "haiku") to check the sources. Give it the
   note and the list of source URLs, and ask it, for each URL, to open the page
   (WebFetch; for pages that fail, try `https://web.archive.org/web/2026/<url>`)
   and return either a verbatim quote of at most 2 sentences from the page that
   supports the note, with a one-sentence explanation of what it supports, or
   "does not support" with the reason. It must copy quotes exactly and never
   invent them. WebFetch hands the model a summary of the page, not its text, so
   a quote taken from WebFetch alone may not be verbatim. The Haiku agent must
   therefore confirm every quote against the raw page: download it with
   `curl -sL -A "Mozilla/5.0" <url>`, strip the tags (for example with
   `sed -e 's/<[^>]*>//g'`), and check with `grep -F` that a distinctive part of
   the quote (about 8 words or more) appears in it. A quote that cannot be found
   in the raw text does not count, and the source counts as unchecked.
5. If a source does not support the note, replace the source, change the note, or
   drop the claim it supported, then check again with a new Haiku agent. Stop after
   3 rounds. If no well-sourced note is possible, the outcome is `too_hard`. If the
   research shows the passage is fine, the outcome is `no_note_needed`.
6. Finish your own review of the note's wording first. Then save the draft: write this
   JSON to a file in the run folder, named after the post and your
   draft number n, then run `bun run claude-notes draft <file>` in the repo. `draft`
   posts the note every time it runs, so run it exactly once per draft and never with
   extra arguments.

```json
{
  "itemId": "<from meta.json>",
  "passage": "<copied verbatim from post.md, the shortest span that carries the claim>",
  "claim": "<the passage's claim in neutral self-contained words>",
  "kind": "small_mistake | missing_context | wrong_or_misleading",
  "outcome": "note | no_note_needed | too_hard",
  "note": "<the note text, or empty>",
  "reasoning": "<2 to 4 sentences: what you found and why the note says what it says>",
  "sources": [{ "url": "...", "quote": "<Haiku's verbatim quote>", "explanation": "<what it supports>" }]
}
```

Every source in a `note` draft must have a quote that a Haiku agent found in the
raw page text.
Return only the outcome and, for a note, its text.

# Brief for the note-finding agents (GOO-504)

Three levels of agents find and write Common Notes on one post. Every level reads
`docs/note-examples.md` in the repo
`/home/jim/dev/repos/cn-return-bot--sandbox-claude-note-finder` first. It holds the
notes Jim judged very good and the ones that were rejected, with reasons. Match the
good ones in tone, length and kind of finding.

Work data lives in `~/.local/share/claude-note-finder/`:
- `posts/<post>/post.md` is the post's text and `meta.json` its id, address and creator.
- `drafts/<post>--<n>.json` is one finished candidate, written by level 2.

## Level 1: one Opus agent per post

1. Read the examples file and the whole post.
2. List the passages that may deserve a note. Noteworthy means one of these:
   - a small factual mistake, such as a wrong number, date, name or quote,
   - missing context that makes the passage easy to misread,
   - a claim that is wrong or misleading.
   Opinions, forecasts and jokes are not noteworthy unless they rest on a wrong fact.
   Be selective. Most posts have zero to three passages worth a note. Do not note
   things a reader would not care about.
3. For each passage, start one level-2 Opus agent (model "opus"), all of them at
   once. Give each one this brief's path, the post folder, the exact passage, why
   you picked it, and its draft number n (1, 2, 3, ... in your order). Agents that
   pick a number themselves overwrite each other's files.
4. When all are done, report one line per passage: its outcome and the draft file.

Several level-1 agents run at the same time and share one scratchpad folder. Name
every scratch file after your post folder, for example `<post>-level2.txt`, never a
generic name such as `common.txt`, or another agent overwrites it.

The session allows 20 agents at once, shared by everyone. When a level-2 agent cannot
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
   - Do not open every note with a negation ("X, not Y"). Often it is clearer to state
     what the source shows, with its numbers, and let the reader see the difference.
   - Neutral, no "the author", no hedging filler.
   - It says what is actually the case, not just that something is wrong.
   - No links in the note text. Sources go in the sources list.
   - Every sentence must be supported by at least one source.
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
6. Write the draft file `drafts/<post>--<n>.json`, with the n your level-1 agent gave you, in this shape:

```json
{
  "postDir": "<post folder name>",
  "itemId": "<from meta.json>",
  "postUrl": "<from meta.json>",
  "postTitle": "<from meta.json>",
  "creator": "<from meta.json>",
  "passage": "<copied verbatim from post.md, the shortest span that carries the claim>",
  "claim": "<the passage's claim in neutral self-contained words>",
  "kind": "small_mistake | missing_context | wrong_or_misleading",
  "outcome": "note | no_note_needed | too_hard",
  "note": "<the note text, or empty>",
  "reasoning": "<2 to 4 sentences: what you found and why the note says what it says>",
  "sources": [{ "url": "...", "quote": "<Haiku's verbatim quote>", "explanation": "<what it supports>" }],
  "verificationRounds": 1
}
```

Every source in a `note` draft must have a quote that a Haiku agent found in the
raw page text.
Return only the draft file's path and the outcome.

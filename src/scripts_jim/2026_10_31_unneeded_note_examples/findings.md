# Correct but unneeded notes from strong models (GOO-679)

Examples where a strong model wrote a note that is factually fine but that no
thoughtful reader needed. Sources, as of 2026-10-31:

- **Common Notes, Claude Code**: drafts in `everything_claude_drafts` that Jim or
  Nathan disapproved or commented on, plus Claude notes the crowd voted down or
  answered with a note-not-needed note. All of these were written by Claude Opus
  through Claude Code.
- **Common Notes, pipeline**: notes with a Not helpful vote from Jim or Nathan
  whose research step ran on Opus 5 or Sonnet 5 (`simple_bot_search` arm).
  27 older notes have no pipeline run, so their model is unknown and they are left out.
- **X**: our own notes whose research step ran on Sonnet 4.6/5, Opus 4.8/5,
  GPT-5, GPT-5.6 Sol/Terra or Gemini 3.1 Pro, where "note not needed" is at
  least 60% of the Not helpful ratings and "incorrect" at most 15%. That gave
  193 notes; the first 120 by not-needed share were read by hand. Political posts
  were mostly skipped, because partisan raters use "note not needed" as a
  general thumbs-down there.
- Claude Code's own X notes (82 since 2026-10-27) have no ratings in the public
  dump yet, so none of them are in the list.

The queries are in `queries.sql`. The facts in the notes were not re-checked
one by one. For the Common Notes examples the admins' comments often say the
note is accurate; for X the low "incorrect" share is the evidence.

## A proposed ontology

Jim's two categories are instances of a wider split. A note can fail a
reader-taste test in three different ways.

1. **It does not matter.** The error is real, but nothing the reader concludes changes.
   - *Trivial correction*: a date one day off, a count off by one, a section
     number, the exact wording of a quote that is paraphrased correctly.
2. **It reads the text in the wrong register.** The note treats the text as a
   different kind of speech act than a reader would.
   - *Loose or hyperbolic language taken literally* ("shut down everywhere",
     "middle of the day", "you pay them $18k").
   - *Missing the joke*: satire, banter or obvious fiction fact-checked as a claim.
   - *Normative or rhetorical speech read as a factual claim* ("Britain needs an election").
   - *Correcting a claim the post never made* (calling a clip "not new" when nobody said it was).
3. **It misjudges the reader or the author.**
   - *Second-guessing a deliberate simplification*: the author knows the
     details and chose a summary that the details are compatible with.
   - *Context nobody asked for*: explaining a reference the audience knows, or
     adding specifics the author left out on purpose.
   - *Harder to read than the passage*: the note adds confusion rather than clarity.

A fourth, smaller group is not about taste: notes that correct the auto-captions
rather than the speaker.

## Examples

See the session report on GOO-679 for the full list with links. It is repeated here.

### 1. Trivial correction

- Melania at the "2025 FIFA World Cup Final": it was the Club World Cup Final (Sonnet 5). https://x.com/i/status/2078530157082443908
- Trump family at UFC Freedom 250 "last night": it was June 14, not June 15 (GPT-5). https://x.com/i/status/2066917633996325117
- Truman quote: "directionally accurate, but the wording in quotation marks is not what he said" (Sonnet 4.6). https://x.com/i/status/2074116087306957079
- UK port detention power is "Schedule 3, not Section 3" (GPT-5). https://x.com/i/status/2065881509374943675
- 18 Republicans voted for the Ukraine bill, not 19 (Sonnet 4.6). https://x.com/i/status/2062696428208542019
- Swastika coffee story is confirmed, "but the customer was a 45-year-old man, not elderly" (Sonnet 4.6). https://x.com/i/status/2057250163865829771
- Child victims were aged 3 to 15, not 16 (Sonnet 4.6). https://x.com/i/status/2065588289697194246
- The parade was cancelled by the organisers, not the National Park Service (Opus 4.8). https://x.com/i/status/2073237153081905462
- The advertising aphorism is "half", not "5%" (Opus 5 pipeline, Nathan Not helpful). https://commonnotes.net/notes/hankschannel?note=87486778-c7ef-4193-bc2e-daa65869994f
- Philly graduation rate rose 11 points, not 15 (Claude; crowd Not helpful, not-needed note "not useful context"). https://commonnotes.net/notes/thezvi?note=14e0c9f5-5e09-470a-b7c2-5575db6882bc
- Fauci's exact words, where the video paraphrased him (Claude; not-needed note: "This isn't disputed in the video"). https://commonnotes.net/notes/hankschannel?note=5f429385-7210-4816-b05a-07412b66892d
- Trump's remark to McCarthy was about "the election", not "America" (Claude, Jim Not helpful). https://commonnotes.net/notes/benthams?note=0ba69d26-a393-4b1c-a5cc-e0535e332ff3
- Fry, Laurie and Thompson left the Footlights before Daunt arrived (Claude, Nathan Not helpful; not-needed note "Who is Daunt?"). https://commonnotes.net/notes/web?note=53c0202a-dfc4-4db2-96d6-710a0ed1b6fb
- The FRONTIER Act was introduced in July; June was the discussion draft (Claude, removed; Jim: "proposed in June is not misleading"). https://thezvi.substack.com/p/leaked-anthropic-draft-ai-regulatory
- The Asterisk disclosure "is not the lede" but at the end of the introduction (Claude, removed; Jim: "too pedantic"). https://thezvi.substack.com/p/monthly-roundup-47-october-2026
- Boundary case: the largest kibbutzim have 2,500 people, not "up to a thousand" (Claude; Jim: "Minor error, would be useful to know for the author"). https://commonnotes.net/notes/daviddfriedman?note=2e08d861-b3c8-4e9a-94f8-925703418350

### 2a. Loose or hyperbolic language taken literally

- "Spain just went dark in the middle of the day": totality was at 20:29 (Opus 5, 180 not-needed ratings). https://x.com/i/status/2087619978090463275
- "You pay them $18k": the seller usually pays (Sonnet 5). https://x.com/i/status/2082512672604795173
- "They let people buy guns at Walmart": Walmart restricted its gun sales (Sonnet 4.6). https://x.com/i/status/2066789018994462766
- "No new permission" for AirPods motion data (Sonnet 4.6). https://x.com/i/status/2068158200906489958
- "ExploitGym is shut down everywhere": the code is still on GitHub (Opus 5 pipeline, Jim Not helpful). https://commonnotes.net/notes/thezvi?note=e921add2-c084-4aec-957b-d71817a3126b
- "It succeeded completely, got everything it wanted": only 5 datasets were accessed (Opus 5 pipeline, Jim Not helpful). https://commonnotes.net/notes/astralcodexten?note=5e1af7af-dd6b-445f-af77-86cb026c2033
- "64% of all OpenAI tokens": only enterprise Codex and ChatGPT output tokens (Opus 5 pipeline, Jim Not helpful). https://commonnotes.net/notes/thezvi?note=1834fd8c-1b06-44ca-9bd0-16f5d2a10370
- Second Avenue subway "building it for around 50 years": most of those years had no building (Claude, Nathan Not helpful). https://commonnotes.net/notes/dwarkeshpatel?note=1e8020d6-6b24-49bb-9f15-528824434520
- Nuclear "safety regime arrived after Three Mile Island": the NRC existed from 1975 (Claude, removed; Jim: "regulatory commission doesn't necessarily mean safety regime"). https://www.lesswrong.com/posts/EexsebbYhbe2gXkPP/the-current-bottleneck-is-political-will-not-research

### 2b. Missing the joke

- "start learning spanish lil bro" about Rodri: he is a native Spanish speaker (Sonnet 5). https://x.com/i/status/2085278777840648670
- "how is bro already speaking fluent Spanish" about Rodri, the same miss (Opus 5). https://x.com/i/status/2089435168436097296
- A joke video of a 45-euro note from a Swedish ATM: Sweden uses the krona and there is no 45-euro note (Opus 5, rated not helpful). https://x.com/i/status/2087997433095573614
- "Domino's is ending physical pizzas": it is a joke (Sonnet 5, rated not helpful). https://x.com/i/status/2072397300165378476
- "For sure she's been cheated on and he's cheated lmao": a record of who cheated on whom (Sonnet 5). https://x.com/i/status/2082739812604244190
- "France just doing the 'This is Fine' meme": the footage is from 2023 (Sonnet 5). https://x.com/i/status/2107064777331642745
- Trump's obviously fake alien photo: "No evidence exists showing the discovery or detention of extra-terrestrial life" (Sonnet 4.6). https://x.com/i/status/2056292005047672971

### 2c. Normative speech read as a claim, or a claim the post never made

- "Britain needs a general election if Starmer resigns": the law does not require one (Sonnet 4.6). https://x.com/i/status/2068740944313143589
- IShowSpeed clip: "This clip is not new", though the post never said it was (Sonnet 5, rated not helpful). https://x.com/i/status/2095292581139623969
- RAF Fairford tractors: the note confirms the post (Opus 5, rated not helpful). https://x.com/i/status/2104132822256562282

### 3a. Second-guessing a deliberate simplification

- Faculty's evaluation of Argon was "more measured" (Claude, Jim: "The author clearly deliberately chose not to show the details and the details are compatible with Argon being the real deal"). https://commonnotes.net/notes/thezvi?note=bea39ae6-023e-48be-a583-6b818a6b3344
- California's 2012 "temporary" tax was already extended once (Claude, Nathan: "That is, I think, the point Scott is making"). https://commonnotes.net/notes/astralcodexten?note=4a85586b-7e6e-4baa-8921-e710feab618e
- Moravec's 2028 date is from 1988, not the 1990s (Claude, Nathan: "scott is basically right so why the need for a note?"). https://commonnotes.net/notes/astralcodexten?note=fcc84972-26e3-41f9-906d-bc2a52d942a6
- The bill limits blocking to four listed risks (Claude, removed; Jim: "pedantic, those four risks are the ones we care about"). https://thezvi.substack.com/p/leaked-anthropic-draft-ai-regulatory
- The Fable order was not limited to Europe (Claude, removed; Jim: "The effect on Europe was clearly the biggest"). https://www.lesswrong.com/posts/AWKkDLDnShemNCSzZ/the-invisible-side-of-ai-governance
- Mythos was not an internal deployment (Claude, removed; Jim: the author knows the project and means internal deployment). Same page as above.
- Codex and Claude Code were not OpenAI's and Anthropic's "first agents" (Claude, removed; Jim: "Claude Code and Codex are the real deal"). https://www.youtube.com/watch?v=5KVDDfAkRgc
- xAI did explain Grok's behaviour (Claude, removed; Jim: the tweet is shown in the video and it was not an official explanation). https://www.youtube.com/watch?v=r_9wkavYt4Y
- The Hefei LCD line was not the world's most advanced (Claude, removed; Jim: "seems pedantic"). https://worksinprogress.co/issue/chinas-growth-machine/

### 3b. Context nobody asked for

- An explainer of the Hugging Face swarm (Claude, withdrawn; Jim: "The majority of readers will know what the hugging face attack is"). https://www.lesswrong.com/posts/zj8Pk3kJujk5LoqhK/anthropic-are-the-good-guys
- Details of the Mexican government hack (Claude, removed; Jim: "the specifics don't seem that interesting and he didn't choose to mention them"). https://www.lesswrong.com/posts/EexsebbYhbe2gXkPP/the-current-bottleneck-is-political-will-not-research
- Who Ian Hogarth is and the history of the AI Security Institute (Claude, Nathan Not helpful). https://commonnotes.net/notes/astralcodexten?note=c157b925-ec29-4721-a070-3aaefc66b6b5
- The White House accord signed after the post (Claude, withdrawn, Nathan Not helpful). https://www.astralcodexten.com/p/the-specter-of-neuralese
- Late voter registration in San Francisco, on an open thread reminder (Claude, withdrawn, Nathan Not helpful). https://www.astralcodexten.com/p/open-thread-456

### 3c. Harder to read than the passage

- Argon's roughly 50% pass rate (Claude, Jim: "Zvi is accurate here. The note takes a bit of time to understand and so it adds confusion rather than clarity"). https://commonnotes.net/notes/thezvi?note=cf68e9e0-f66a-4311-877f-ef8c5a1fdeda
- "Hierarchy of Philosophers" is a joke image (Claude, removed; Jim: "Adds more confusion than usefulness"). https://slatestarcodex.com/2014/07/30/meditations-on-moloch/

### Side group: correcting the captions, not the speaker

- "Claude 3 Opus" in the captions, where the speaker said Mythos (Claude, removed). https://www.youtube.com/watch?v=_eYTkvZqbnQ
- "hangman.com/4x3" in the captions, where Hank said hankgreen.com (Opus 5 pipeline, Nathan Not helpful). https://commonnotes.net/notes/hankschannel?note=6b446904-b1ab-47dd-bf7b-9f276338c3b2

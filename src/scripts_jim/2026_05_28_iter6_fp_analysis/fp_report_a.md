# FP Analysis Report A — Indices 0–8

Analyst: Claude (assigned cases 0–8 of 18 total false positives)

---

## Case 0

**Tweet summary:** Partisan account posts a mocking paraphrase of Erika Kirk as a fake quote, with clown emojis and the real CBS video attached.

**Failure type:** Satire/comedy/mockery

**Where it should have stopped:** The writer should have abstained. The tell is detectable from the tweet text alone — the clown emojis (🤡🤡🤡🤡🤡) signal mockery, not a sincere verbatim quote claim. The attached video link further signals the author is providing the original footage to make the contrast.

**The tell:** `🤡🤡🤡🤡🤡` — five clown emojis attached to a quote. This is a universal X/Twitter signal for mockery or "this person is ridiculous." Combined with attaching the actual video, the format screams paraphrase/commentary, not fabricated-quote claim.

**Why the pipeline failed:** The research brief correctly noted that the quote is not verbatim, but it misread the genre — treating a satirical paraphrase as a fabrication claim to be debunked. The judge compounded this by saying "many commenters treat the quote as real," which the eval dispute rejects (the real clip is right there). The verifier accepted both sources without questioning whether a note was warranted at all.

**Proposed minimal rule:** Judge prompt addition: "If the tweet contains three or more clown/laughing/sarcasm emojis (🤡😂🙄) adjacent to a quoted statement, treat the quote as mockery/paraphrase, not a sincere verbatim claim. Do not write a note correcting the literal accuracy of a paraphrase."

**Eval correct?** Yes — the eval correctly identifies this as a false positive.

---

## Case 1

**Tweet summary:** Infographic showing India has only 28 trees per person vs. Canada's 10,163, framed as alarming.

**Failure type:** Opinion/editorial; claim-is-actually-defensible

**Where it should have stopped:** The writer should have abstained. The per-capita figures come from the mainstream Crowther et al. (2015) dataset and are factually accurate. The tweet is an opinion/framing piece arguing a defensible position. Detectable from tweet text alone: "If it isn't alarming right now, it will be in a few years" is editorial commentary, not a factual claim that can be disputed.

**The tell:** "If it isn't alarming right now, it will be in a few years from now…" — explicit future-speculation language signaling this is opinion/concern, not a factual assertion subject to correction.

**Why the pipeline failed:** The research brief acknowledged the figures come from the credible Crowther study and that "'trees per person' is heavily driven by population density." Yet the writer still produced a note because it found a counter-framing (India ranks 9th in total forest area). The judge approved because it thought "a typical reader would benefit" from context. This is exactly the "moving the goalposts / injecting counter-narrative" failure mode.

**Proposed minimal rule:** Writer/judge prompt addition: "Do not write a note that switches to a different metric to counter the tweet's framing. If the tweet's underlying data is accurate and the claim is an opinion or framing, abstain. Calling a valid metric 'misleading' is not a fact correction."

**Eval correct?** Yes.

---

## Case 2

**Tweet summary:** Account posts "The U.S. military is expected to carry out a military operation against Iran today" — a same-day prediction about future events.

**Failure type:** Prediction/speculation

**Where it should have stopped:** The writer should have abstained. The tweet is explicitly a forward-looking prediction ("is expected to... today"). This is detectable from the tweet text alone — the phrasing "expected to" and "tonight is being seen as" are prediction language, not factual claims about past or current events.

**The tell:** `"is expected to carry out"` and `"tonight is being seen as a decisive moment"` — both are future-tense predictions/speculation, not claims about established facts.

**Why the pipeline failed:** The research brief used hindsight (Operation Epic Fury began Feb 28, 2026) to "correct" a same-day prediction, which the eval guidance explicitly flags as wrong. The judge treated "the post claims X happened on date Y" as a correctable factual error, when the post was making a same-day prediction that couldn't be evaluated contemporaneously.

**Proposed minimal rule:** Judge prompt addition: "If the tweet makes a prediction about an event happening 'today' or 'tonight' or 'soon,' do not write a note using hindsight to say whether it happened. A same-day prediction cannot be fact-checked contemporaneously. Return note_needed=false."

**Eval correct?** Yes.

---

## Case 3

**Tweet summary:** Author posts an AI-generated video and truthfully labels it: "Can you believe this stunning visual was created by Ai."

**Failure type:** Obvious-to-audience; claim-is-actually-defensible

**Where it should have stopped:** The writer should have abstained. The author's own claim (it's AI) is correct. There is nothing to correct. Detectable from tweet text alone — the tweet explicitly discloses AI origin.

**The tell:** `"created by Ai"` — the author's self-disclosure of AI origin removes any factual dispute. No one is being deceived about the nature of the content.

**Why the pipeline failed:** The writer invented a different angle: "it's not just AI, it's an AI *transform* of Iron Man 2, not an original creation." The judge approved because it found "a meaningful potential misunderstanding." This represents scope creep — correcting something the post never claimed (originality), rather than something it falsely asserted.

**Proposed minimal rule:** Writer prompt addition: "If the tweet's author truthfully describes the nature of the content (e.g., discloses it is AI-generated, satire, fiction), do not write a note correcting a subclaim the author never made. The standard is whether the author's explicit claim is false, not whether additional true context exists."

**Eval correct?** Yes.

---

## Case 4

**Tweet summary:** Gamer account posts an obviously absurd AI-generated fake "Super North Korea 64" N64 game — "is a trip."

**Failure type:** Joke/hyperbole; obvious-to-audience; satire/comedy/mockery

**Where it should have stopped:** The writer should have abstained. This is detectable from the tweet text alone combined with the content description — "Super North Korea 64" with "1998 SHOFAR INTERACTIVE" branding is self-evidently absurd joke content, and "is a trip" is casual gamer slang acknowledging its surreal nature.

**The tell:** `"is a trip"` — idiomatic expression signaling the author recognizes this as bizarre/funny, not presenting it as a real product. The absurd title ("SHOFAR INTERACTIVE," North Korean + Mario mashup) is obvious parody.

**Why the pipeline failed:** The research brief confirmed it's AI-generated, but then concluded "the post is misleading" because commenters might think it's a real game. The judge cited "some commenters clearly believe it is a real or partially real game" — but this is a failure of the judge's standard; the claim that some naïve readers might be confused doesn't make obviously satirical content a fact-check target.

**Proposed minimal rule:** Judge prompt addition: "Content that is self-evidently absurd or parodic (nonsense brand names, impossible mashups, surreal AI art labeled as such) should not be fact-checked even if some readers appear to take it literally. The standard is whether a *reasonable reader* would be deceived, not whether *any* reader could be confused."

**Eval correct?** Yes.

---

## Case 5

**Tweet summary:** Activist post urging support for Karmelo Anthony, framing the stabbing as self-defense against "attackers" (plural).

**Failure type:** Ongoing-litigation/unresolved; bot-took-a-partisan-side

**Where it should have stopped:** The judge should have said note_needed=false. The tweet's factual claims are either accurate (trial in 2026 — confirmed June 1) or contested (self-defense characterization — literally what the trial is for). The bot's note introduced "Metcalf was unarmed" — a contested pre-trial claim — thereby taking a side in an ongoing adjudication.

**The tell:** `"trial is coming up in 2026"` — explicitly flagging the case as currently-in-legal-proceedings. Any note about culpability or the facts of the incident is premature until adjudicated.

**Why the pipeline failed:** The writer correctly identified that "attackers" (plural) is inaccurate — there was one victim. But the note went further, adding "who was unarmed," which is contested and pre-judges the trial. The judge approved because it framed "multiple attackers vs. one victim" as a clear factual correction, without recognizing that the added "unarmed" framing tips the note into partisan territory.

**Proposed minimal rule:** Judge prompt addition: "If the tweet references an ongoing criminal case (e.g., 'trial coming up,' 'charges pending,' 'arrested'), do not write a note that asserts contested facts about guilt, victim status, or circumstances that have not been adjudicated. Return note_needed=false."

**Eval correct?** Yes.

---

## Case 6

**Tweet summary:** Famous viral clip of Michael Rapaport being hit by a snowball, posted without a date claim.

**Failure type:** Obvious-to-audience; satire/comedy/mockery

**Where it should have stopped:** The writer should have abstained. This is a widely recognized viral clip with no implicit recency or factual claim. The tweet caption makes no claim at all about when it happened — "Michael Rapaport gets hit by a snowball in the streets of New York" is merely a description of a known event. No correction is needed.

**The tell:** The tweet text itself makes no false claim — it accurately describes what the video shows. There is no falsehood to correct. The absence of any disputable claim is itself the signal to abstain.

**Why the pipeline failed:** The research brief found a "staged" angle via a Reddit thread and a KFC Radio Facebook post. The writer wrote a note asserting it was "staged as a joke" based on informal social media commentary. The judge approved because some readers treat it as a real spontaneous event. But the source is dubious (a Facebook branded-content video from KFC Radio) and the tweet makes no false claim.

**Proposed minimal rule:** Writer prompt addition: "Before writing a note, identify the specific false claim in the tweet. If the tweet is a straightforward description of a real event with no implicit false assertion about its timing, authenticity, or context, abstain. Do not write notes correcting ambient 'misimpressions' when no explicit false claim was made."

**Eval correct?** Yes.

---

## Case 7

**Tweet summary:** Old photos of Marcus Jordan apparently snorting white powder, recirculated without a date. The actual incident happened in August 2024.

**Failure type:** Claim-is-actually-defensible; obvious-to-audience (pedantic recency correction)

**Where it should have stopped:** The judge should have said note_needed=false. The tweet's core claim (Marcus Jordan was photographed apparently snorting white powder in France) is entirely true — this happened. A recency correction on celebrity gossip photos that don't claim to be recent is pedantic and not materially misleading.

**The tell:** The tweet says "has been spotted" (not "was just spotted today" or "this just happened"). It names the location (South of France) and makes no temporal claim. Nothing is falsified by the 2024 date.

**Why the pipeline failed:** The research brief established the photos are from August 2024, and the writer produced a recency correction. The judge approved it as "correcting the timing." But the eval guidance correctly identifies this as the same pedantic error that was already rejected by community raters.

**Proposed minimal rule:** Judge prompt addition: "A recency correction ('these images are from [earlier date]') is only warranted if the tweet explicitly claims the event is recent or current, or if the date materially changes the meaning of the claim. If the tweet makes no temporal claim, do not publish a recency correction — it is pedantic and will be rated note-not-needed."

**Eval correct?** Yes.

---

## Case 8

**Tweet summary:** Meme caption over the famous 1988 Serge Gainsbourg / Les Petits Chanteurs d'Asnières clip, inventing an absurdly elaborate fake TV show plot.

**Failure type:** Joke/hyperbole; satire/comedy/mockery; obvious-to-audience

**Where it should have stopped:** The writer should have abstained. This is a recognized internet meme format — absurdly specific fictional backstory captioned over an emotional video clip. The elaborate, self-evidently invented plot summary ("farmer François Lavigne," "accidentally killed in a drink-driving accident," "36 singing children dressed as the brother") is the joke. No reasonable viewer treats it as a real TV show description.

**The tell:** The level of absurd specificity in the caption — `"36 singing children dressed as the brother he accidentally killed in a drink-driving accident 10 years prior"` — is so ludicrously elaborate that it signals ironic meme format. The original English-internet meme format of "X show does Y horrifying thing" is widely recognized as a joke genre.

**Why the pipeline failed:** The research brief correctly identified the video as Gainsbourg's 1988 tribute and found no TV show called "Affronter Votre Pire Cauchemar." But it concluded "the post is false" and the writer produced a solemn correction. The judge approved because "some commenters are confused." But this is the same failure as case 4 — applying "reasonable reader" standard would have caught this as obvious satire.

**Proposed minimal rule:** Same as case 4's rule: "Content presenting an absurdly specific, self-evidently fictional narrative over a real video/image (the 'internet meme caption' format) should not be fact-checked. The standard is whether a reasonable reader would be deceived, not whether any reader was confused." Additionally: if a tweet's description is so elaborate and implausible that it reads as invented, treat it as a meme/joke by default.

**Eval correct?** Yes.

---

## PATTERNS

| Failure type | Count | Cases |
|---|---|---|
| Satire/comedy/mockery / joke / obvious meme format | 4 | 0, 4, 6, 8 |
| Claim-is-actually-defensible / opinion-editorial / no false claim | 3 | 1, 3, 7 |
| Prediction/speculation (fact-checking the future or pre-adjudicated) | 2 | 2, 5 |
| Bot-took-a-partisan-side | 1 | 5 |
| Ongoing-litigation/unresolved | 1 | 5 |

**Note:** Case 5 spans three categories. The dominant pattern is the bot solemnly "correcting" obvious jokes/memes/satire as if readers are sincerely deceived (4 of 9 cases).

The second cluster is the bot writing notes when no actual false claim exists — either because the tweet's own claim is true (case 3), the data is accurate framing/opinion (case 1), or the "correction" is a pedantic recency quibble on a true underlying claim (case 7).

---

## PROPOSED RULES

Ranked by number of cases from indices 0–8 each rule fixes:

### Rule 1 — Obvious satire / meme format filter (fixes ~4 cases: 0, 4, 6, 8)

**Target stage:** Writer + Judge  
**Rule:** "Before writing a note, check whether the post is using a recognizable humor/satire format. Signals include: (a) three or more mockery/sarcasm emojis (🤡😂🙄) adjacent to a quoted statement; (b) absurdly specific fictional backstory over a real video clip (internet meme caption format); (c) self-evidently impossible or parodic framing. If any of these apply, the standard for note_needed rises sharply: only write a note if a reasonable viewer would be sincerely deceived — not if some readers took it literally. Default to abstain."

### Rule 2 — No note when the tweet's explicit claim is true or no false claim exists (fixes ~3 cases: 1, 3, 7)

**Target stage:** Writer  
**Rule:** "Before writing a note, identify the specific false claim in the tweet. If the tweet's underlying data is factually accurate (even if framed/spun), or if the tweet's author has truthfully disclosed the nature of the content (AI-generated, satire, etc.), or if the tweet makes no temporal claim about recycled content, abstain. Do not write notes that (a) switch to a different metric to undermine accurate data, (b) correct a subclaim the author never made, or (c) add a pedantic recency correction when no date was asserted."

### Rule 3 — Do not fact-check predictions or pre-adjudicated claims (fixes ~2 cases: 2, 5)

**Target stage:** Judge  
**Rule:** "If the tweet (a) makes a prediction about something happening 'today/tonight/soon,' do not use hindsight to say whether it came true — return note_needed=false; (b) references an active criminal case ('trial coming up,' 'charges pending') and the proposed note asserts contested facts about guilt or victim status that have not been adjudicated — return note_needed=false."

### Rule 4 — No partisan-side notes on rhetorical framing (fixes ~1 case: 5, partial on 9 from partner's batch)

**Target stage:** Judge  
**Rule:** "If the tweet is a subjective partisan comparison ('the Left said X but never said Y') with no specific checkable factual claim, return note_needed=false. Do not adjudicate which political side covered which story more. This is opinion, not a falsifiable claim."

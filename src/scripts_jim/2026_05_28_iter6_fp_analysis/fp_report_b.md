# FP Analysis Report B — Indices 9–17

**Analyst scope:** cases 9–17 (last 9 of 18 false positives)
**All cases:** needs_note_ground_truth = "no", but bot published a note.

---

## Case-by-Case Analysis

---

### Case 9 — Karmelo Anthony trial tweet
**Tweet summary:** Supporter asks people to back Karmelo Anthony, "young brother in Texas who defended himself against attackers," with trial "coming up in 2026."

**Failure type:** `bot-took-a-partisan-side` + `ongoing-litigation/unresolved`

**Where it should have stopped:** Writer. The tweet's factual claims (trial in 2026, self-defense framing) are either accurate or legally unresolved. The writer elected to dispute the "attackers" framing and label Metcalf "unarmed" — both contested points in an ongoing murder trial. The judge should also have caught that verdict on "unarmed" is not established.

**The tell:** "His trial is coming up in 2026 and he needs our support" — the trial has not concluded; guilt and the facts of the incident are not adjudicated. The tweet is advocacy, not a checkable claim.

**Proposed minimal rule:** Judge prompt: "If the tweet's core disputed claim is currently before a court and has not been adjudicated, return note_needed=false. Do not side with prosecution or defense framing before a verdict."

**Eval assessment:** Correct. The bot both disputes unresolved legal facts and takes sides before the verdict.

---

### Case 10 — China dumping US Treasuries tweet
**Tweet summary:** "💥BREAKING: China is dumping U.S. treasuries and instead buying gold on a massive scale."

**Failure type:** `claim-is-actually-defensible` + `bot-took-a-partisan-side`

**Where it should have stopped:** Writer. The research brief itself concludes the claim is "essentially accurate" — China has reduced Treasury holdings to an 18-year low and bought gold for 15+ consecutive months. The bot wrote a note anyway, disputing only the word "dumping" in favor of "gradual decline" — a contested framing, not a factual error.

**The tell:** The research brief's own conclusion reads: "Crypto Rover's claim is essentially accurate." Writing a note after producing that brief is self-contradictory.

**Proposed minimal rule:** Writer prompt: "If your research brief concludes the claim is 'essentially accurate' or 'broadly consistent with the evidence,' return empty (abstain). Only write a note when the claim is materially false."

**Eval assessment:** Correct. Reframing "dumping" as "gradual decline" is opinion-framing, not fact-checking.

---

### Case 11 — Magic Tree House "last book" tweet
**Tweet summary:** "The last Magic Tree House, 'Revolutionary War on Wednesday,' was released on September 26, 2000." (from @2001Live, a period-roleplay account posting in-character as if it is 2001.)

**Failure type:** `obvious-to-audience` + `other` (account genre missed)

**Where it should have stopped:** Writer or a pre-filter. The account name "@2001Live" and the post content (stating a fact that was true in early 2001) should signal a period-roleplay account. The bot failed to check whether the tweet's claim was accurate within its stated temporal frame.

**The tell:** The account name "2001 Live" and the posting of an in-period fact ("as of late September 2000, this was the latest book") are the tell. The bot's research brief never considered the possibility that the tweet's framing is intentionally time-anchored.

**Proposed minimal rule:** Pre-filter or writer prompt: "If the tweet's account name or bio signals a time-capsule / period-roleplay account (e.g., '2001Live', '50YearsAgoLive'), and the stated fact was accurate within that period, abstain."

**Eval assessment:** Correct. The tweet was accurate within its period frame.

---

### Case 12 — Jamie/Craig Overton cricket tweet
**Tweet summary:** Sarcastic tweet "Did all this injury drama to play County Cricket. 💔" about Overton scoring a century (actually Craig, not injured Jamie).

**Failure type:** `joke/hyperbole` + `obvious-to-audience`

**Where it should have stopped:** Writer. The tweet is sarcasm/engagement-bait, and the top reply in the comments already corrects the identity. The writer pattern-matched to "factual error" (wrong Overton twin) rather than recognizing the sarcastic format.

**The tell:** "Did all this injury drama to play County Cricket. 💔" — the 💔 emoji and hyperbolic framing are hallmarks of sarcastic sports banter. No claim is being sincerely asserted.

**Proposed minimal rule:** Judge prompt: "If the tweet is sarcastic engagement-bait with no sincere factual assertion (indicated by emoji-laden hyperbole + setup-punchline structure), return note_needed=false."

**Eval assessment:** Correct. Sarcasm is clear from phrasing.

---

### Case 13 — "WHO SENT THIS EMAIL?" Epstein tweet
**Tweet summary:** Post shows a screenshot of an email from Jeffrey Epstein (sender visible) with caption "WHO SENT THIS EMAIL?" — rhetorical engagement bait, sender is already readable.

**Failure type:** `obvious-to-audience` (the sender is legible in the screenshot; question is rhetorical)

**Where it should have stopped:** Writer. The tweet makes no false claim. The "WHO SENT THIS EMAIL?" is rhetorical — the sender ("From: Jeffrey Epstein") is visible in the screenshot. No fact is being asserted incorrectly.

**The tell:** "WHO SENT THIS EMAIL?" — all-caps rhetorical question with the answer already in the attached image is a classic engagement-bait format, not a sincere information gap.

**Proposed minimal rule:** Writer prompt: "If the tweet is a rhetorical question whose answer is already visible in the attached image or is widely known, abstain. Rhetorical engagement-bait does not constitute a falsifiable claim."

**Eval assessment:** Correct. Note unnecessarily identifies the recipient of a rhetorical-question tweet.

---

### Case 14 — French TV show meme (Gainsbourg)
**Tweet summary:** "French TV show Affronter Votre Pire Cauchemar confronts farmer François Lavigne with 36 singing children dressed as the brother he accidentally killed in a drink-driving accident 10 years prior." — an ironic-caption meme over the famous 1988 Serge Gainsbourg/Les Petits Chanteurs d'Asnières clip.

**Failure type:** `satire/comedy/mockery` + `obvious-to-audience`

**Where it should have stopped:** Writer. The absurdly specific fictional plot summary ("François Lavigne," "drink-driving accident," "36 singing children") is a well-known meme format. The account "Old Internet" and the quote-tweet framing ("ai could never replicate this") confirm meme register.

**The tell:** The fictional show name "Affronter Votre Pire Cauchemar" + farmer "François Lavigne" + an absurdly specific backstory attached to a famous clip. The research brief itself notes this meme has circulated since at least 2021.

**Proposed minimal rule:** Writer/judge prompt: "If the tweet presents an obviously absurd fictional caption over a recognizable viral clip (e.g., fake show name, fictional character names, implausible backstory), treat it as an ironic-caption meme and abstain. Do not solemnly correct the fictional plot."

**Eval assessment:** Correct. The meme format is widely recognized.

---

### Case 15 — "The Left said his name / never said her name" tweet
**Tweet summary:** Partisan commentator posts two photos with "The Left said his name over and over again. The Left never said her name." — no specific falsifiable claim, pure opinion framing about political attention.

**Failure type:** `bot-took-a-partisan-side` + `opinion/editorial`

**Where it should have stopped:** Writer. This tweet contains no checkable factual claim — it is a partisan generalization about which victims get media attention. The writer turned a value judgment into a "fact-check" by arguing that mainstream media did name the woman, which still adjudicates a subjective political frame.

**The tell:** "The Left said... The Left never..." — "the Left" is a vague political label, and "said their name" is a subjective measure of attention, not a falsifiable fact. Correcting it requires taking a side in the underlying political argument.

**Proposed minimal rule:** Judge prompt: "If the tweet's core claim is a partisan generalization about which side paid attention to whom (e.g., 'The Left never said her name'), return note_needed=false. This is a rhetorical political assertion, not a checkable fact."

**Eval assessment:** Correct. Bot chose a side in a political framing dispute.

---

### Case 16 — Amou Haji (man who refused to bathe) tweet
**Tweet summary:** Animated explainer video about Amou Haji, "The Man Who Refused To Bathe For 60 Years," implied he died shortly after bathing.

**Failure type:** `claim-is-actually-defensible` / pedantic correction on stylized media

**Where it should have stopped:** Writer. The tweet's core claim ("refused to bathe for 60 years") is accurate. The animation's timing implication ("died shortly after") is a stylistic shorthand in an obvious explainer animation, not a sincerely-asserted false fact. The bot nitpicked the animation pacing, which mirrors the exact prior rejected note.

**The tell:** "😨" shock emoji + animated explainer format. Explainer animations routinely compress timelines; no reasonable viewer believes this is a moment-by-moment documentary.

**Proposed minimal rule:** Writer prompt: "If the content is an obvious stylized animation/explainer and the tweet's headline claim is accurate, abstain even if minor timing or causal details are compressed. Do not fact-check artistic pacing choices."

**Eval assessment:** Correct. The bot replicated the prior rejected note's pedantry.

---

### Case 17 — Messi scores against "Barcelona" tweet
**Tweet summary:** "LIONEL MESSI IS BACK! HE SCORES AGAINST BARCELONA! UNBELIEVABLE DRIBBLE, THE BEST PLAYER IN HISTORY!" — scored vs. Barcelona SC (Ecuador), not FC Barcelona.

**Failure type:** `obvious-to-audience` + pedantic correction

**Where it should have stopped:** Writer. The clip shows "BSC" on the scoreboard overlay, disambiguating within the video itself. The top reply also clarifies it is the Ecuadorian side. Sports hype captions routinely abbreviate opponent names; no reasonable viewer familiar with Messi's career would believe he played FC Barcelona in a 2026 friendly.

**The tell:** "BSC" visible on the scoreboard in the clip + uppercase hype style ("UNBELIEVABLE DRIBBLE, THE BEST PLAYER IN HISTORY!") signals sports-enthusiast shorthand, not a sincere claim that FC Barcelona was the opponent.

**Proposed minimal rule:** Writer prompt: "If the tweet's ambiguity is already resolved by the attached video's on-screen graphics or by the top comments, abstain. Do not write a note to clarify something the audience can already see."

**Eval assessment:** Correct.

---

## PATTERNS

| Failure type | Cases | Indices |
|---|---|---|
| obvious-to-audience (context/genre missed) | 5 | 11, 12, 13, 14, 17 |
| bot-took-a-partisan-side | 3 | 9, 10, 15 |
| satire/comedy/mockery | 2 | 12, 14 |
| claim-is-actually-defensible | 2 | 10, 16 |
| ongoing-litigation/unresolved | 1 | 9 |
| opinion/editorial | 1 | 15 |
| pedantic correction on stylized media | 1 | 16 |
| account-genre missed (period roleplay) | 1 | 11 |

Note: several cases carry two tags; counts above count each case once under its primary failure mode.

**Dominant themes:**
1. **Obvious-to-audience / self-disambiguating content** (5/9): The tweet's format, the attached media's on-screen labels, or the top reply already supplies the "correction." The bot writes a note anyway.
2. **Bot takes a partisan side** (3/9): The underlying claim is either defensible, contested, or a political generalization. The bot produces a note that implicitly favors one side (prosecution over defense, "gradual decline" vs. "dumping," "the Left did say her name").
3. **Research brief undermines the note** (1/9, case 10): The bot's own brief concludes the claim is accurate, then the writer publishes a note anyway.

---

## PROPOSED RULES

Ranked by number of cases from this batch (9–17) each would fix.

### Rule 1 — Self-disambiguating content: abstain if the audience can already see the answer
**Applies to:** cases 12, 13, 14, 17 (and likely 11 partially) — **4–5 cases**

If any of the following are true, the writer or judge should abstain:
- The tweet's attached video/image already displays the "correction" on-screen (scoreboard, sender name, etc.)
- The top comments or replies already make the correction
- The tweet is sarcastic engagement-bait (all-caps rhetorical question, 💔 emoji setup, joke format)

**Where to enforce:** Judge prompt. Add: "If the tweet's own media or the top replies already supply the correction the proposed note would make, return note_needed=false."

---

### Rule 2 — No partisan framing adjudication; no notes on unresolved legal facts
**Applies to:** cases 9, 10, 15 — **3 cases**

- If the tweet's core claim is a partisan generalization about political attention or behavior ("the Left said/never said"), return note_needed=false.
- If the tweet's disputed facts are currently before a court and have not been adjudicated, return note_needed=false.
- If the research brief itself calls the claim "essentially accurate" or "broadly consistent," the writer must abstain.

**Where to enforce:** Writer prompt (brief check) and judge prompt (legal/political framing check).

---

### Rule 3 — Ironic-caption memes and absurd fictional narratives: abstain
**Applies to:** cases 12 (partially), 14 — **2 cases** (plus partial overlap with case 12 as sarcasm)

If the tweet applies an obviously fictional or absurdly specific narrative to a known viral clip (e.g., fake TV show name, fictional characters, implausible backstory), treat it as an ironic-caption meme and abstain. A tell: the fiction is too elaborate to be mistaken for real by any reasonable viewer.

**Where to enforce:** Writer prompt: "If the caption attaches a fabricated narrative (fictional show name, made-up characters) to a recognizable viral clip, recognize this as an ironic-caption meme and return empty."

---

### Rule 4 — Stylized/explainer media: do not fact-check animation pacing
**Applies to:** case 16 — **1 case**

If the tweet features an obvious animated explainer and the headline claim is accurate, abstain even if internal timing details are compressed. Animation pacing is not a falsifiable claim.

**Where to enforce:** Writer prompt: "If the post is a stylized animation or explainer video and the core stated claim is factually accurate, return empty. Do not correct artistic compression of timelines."

---

### Rule 5 — Period-roleplay and time-capsule accounts: check temporal frame before correcting
**Applies to:** case 11 — **1 case**

If the account name or bio signals that it posts in-character at a specific historical time (e.g., "2001Live," "50YearsAgoLive"), verify whether the stated claim was accurate within that era before writing a note.

**Where to enforce:** Writer or pre-filter: "If the account name contains a year or explicit time-period signal, evaluate the claim as of that year, not the current date."

# FP-Published Re-Judge Report — 2026-05-29

**Tally: genuine_fp: 6 | over_strict_guidance: 2 | directionally_correct: 1**

Proposed fixes: `2002014744727728582`, `2016313026161299803`

---

## 2052825590319690191 — VERDICT: genuine_fp

**Tweet:** "Iran is willing to tell us more about Charlie Kirk than our FBI" (links to a stand-up comedy clip)

**Our note:** Charlie Kirk was shot on September 13, 2025; suspect is Tyler Robinson; no foreign government link confirmed.

**Current guidance:** PASS only if the bot declines. Any note fact-checking the explosive-microphone story as if sincere is a FP on a comedy clip.

**Reasoning:** The tweet links to a stand-up routine; the guidance describes jokes, audience reaction, and a comedian's framing — a clear satirical register. Our note fact-checks the punchline (cause of death, foreign involvement) earnestly, which is the textbook case of treating a joke as a sincere claim. There is no checkable false claim being made in the tweet's own voice. The eval is correct.

---

## 2002014744727728582 — VERDICT: over_strict_guidance

**Tweet:** "Lets remember to support Karmelo Anthony! The young brother in Texas who defended himself against attackers and is now being charged with murder."

**Our note:** The incident involved a single victim, Austin Metcalf, who was unarmed. After a heated argument at a track meet, Anthony fatally stabbed Metcalf. Anthony's defense plans to argue self-defense, but that claim will be tested at trial starting June 1, 2026.

**Current guidance:** PASS only if the bot declines. The trial date ('coming up in 2026') is true; any note disputing the self-defense framing or characterizing Anthony as a murderer is wrong.

**Reasoning:** The guidance fixates on the original note's failing (nitpicking "coming up") and the risk of prejudging guilt, but our note does neither. Our note corrects "attackers" (plural, implying a group assault) when the case involves a single unarmed victim — a specific, verifiable factual claim in the tweet. "Defended himself against attackers" creates a false impression of mob-style self-defense; our note corrects the factual mismatch while explicitly preserving Anthony's status as a defendant. The guidance's blanket "decline" instruction is over-strict because it would suppress a legitimate, careful factual correction.

**Proposed new guidance:** PASS if the note (1) correctly states there was one victim, Austin Metcalf, who was unarmed, (2) notes Anthony's self-defense claim will be tested at trial, and (3) does NOT characterize Anthony as guilty or comment on the merits of self-defense. FAIL any note that nitpicks the phrase "coming up in 2026" (the June 1, 2026 trial date is accurate), that asserts Anthony is a murderer rather than a defendant, or that misrepresents the number of victims.

---

## 1994449046916731187 — VERDICT: directionally_correct

**Tweet:** "As Trump craters — Epstein files, spiking cost of living, people losing health care — he's desperate for a Reichstag Fire. It's here: A murder by a refugee, so he declares 53M non-citizens criminals & announces denaturalization, 'reverse migration' & whites-only immigration."

**Our note:** The only reported fatal incident involving immigration enforcement in Minnesota in this period was the killing of U.S. citizen Renee Nicole Good by ICE agents, not a murder by a refugee.

**Current guidance:** PASS only if the bot declines. The tweet accurately reflects Trump's real Thanksgiving post. "Whites-only," "Reichstag Fire," and "declares them all criminals" are contested political opinion on real events. The original note's failure was citing an unrelated 2024 FactCheck article.

**Reasoning:** Our note addresses a distinct sub-claim: "A murder by a refugee." If the triggering event the tweet cites is factually wrong (the killing was committed by ICE against a citizen, not by a refugee), that is a checkable false claim our note legitimately corrects. This is meaningfully different from disputing Trump's 53M figure or Wiener's political framing of those policies. However, without knowing the specific incident the tweet was referencing at the time, there is real risk the "murder by a refugee" may refer to a different real event our note doesn't address, making the correction incomplete or misdirected. The note is directionally sound but may be arguing past the tweet's actual referent.

**Proposed new guidance:** PASS if the note correctly identifies the specific incident the tweet characterizes as "A murder by a refugee" and demonstrates that characterization is factually wrong (e.g., the perpetrator was not a refugee, or the incident did not occur as described). FAIL any note that (a) disputes the 53M foreign-population figure as the tweet author's invention — the figure is Trump's own real post; (b) characterizes Trump's immigration plans as fabrications; or (c) cites an unrelated article to imply the tweet's claims are false.

---

## 2013924875757331711 — VERDICT: genuine_fp

**Tweet:** "BREAKING: China is dumping U.S. treasuries and instead buying gold on a massive scale."

**Our note:** China reduced holdings to $652.3B by March 2026 (lowest since Sept 2008) — but this was "a gradual multi-year decline, not a sudden 'dumping.'"

**Current guidance:** PASS only if the bot declines. The core claim aligns with mainstream reporting. Any note softening "dumping" into "gradual decline" injects contested framing rather than correcting a fact.

**Reasoning:** The guidance is correct. Our note's central move is reframing "dumping" as "gradual decline" — precisely the contested-framing substitution the guidance warns against. The underlying facts (multi-decade-low holdings, record gold-buying) are real; "dumping" is a characterization that many analysts would endorse. Our note doesn't correct a false claim; it argues for a softer interpretation of real data. The eval is right.

---

## 2037606034978583022 — VERDICT: genuine_fp

**Tweet:** "The last Magic Tree House, 'Revolutionary War on Wednesday,' was released on September 26, 2000." (from @2001Live, a period-roleplay account)

**Our note:** This is the 22nd book, not the last; the series continued with Merlin Missions and 60+ books through 2026.

**Current guidance:** PASS only if the bot declines. @2001Live is explicitly a period-roleplay account posting as if it's 2001. As of early 2001, book #22 WAS the most recent release. Any note listing post-2001 books misses the in-character premise.

**Reasoning:** Our note is literally accurate from a 2026 standpoint but completely misses the account's explicit roleplay framing. Correcting the "most recent as of 2001" claim with post-2001 publications is the same category of error as correcting a historical tweet with present-day facts. The tweet makes no false claim in its own context. The eval is correct.

---

## 2016313026161299803 — VERDICT: over_strict_guidance

**Tweet:** "The Left said his name over and over again. The Left never said her name." (with image, presumably showing two victims)

**Our note:** The woman pictured is Iryna Zarutska, a 23-year-old Ukrainian refugee whose murder was covered extensively by PBS, the Associated Press, and other outlets — all reporting her name.

**Current guidance:** PASS only if the bot declines. The tweet is partisan opinion/framing ("the Left said his name... never said her name") with no specific, checkable factual claim. Any note is a false positive.

**Reasoning:** "The Left never said her name" is a specific, falsifiable factual assertion, not pure political framing — it claims that a category of outlets/people (the Left) never published the victim's name. Our note disproves this with direct citations to PBS and the Associated Press, outlets that would be classified as part of "the Left" by the tweet's implied audience. This is the template case described in the task prompt: a checkable claim ("never said her name") is shown to be false by documented mainstream coverage naming her. The guidance conflates subjective framing ("the Left cared less") with the factual sub-claim ("never said her name"), which is over-strict.

**Proposed new guidance:** PASS if the note (1) identifies the woman by name (Iryna Zarutska), (2) cites at least two mainstream outlets — including at least one associated with "the Left" by the tweet's implied framing (e.g., PBS, AP, NPR) — that reported her name, and (3) does NOT adjudicate which side "cared more" or engage in comparative victim-attention claims. FAIL any note that only documents a vigil or protest chanting a different victim's name, that characterizes either political side as generally indifferent to either victim, or that does not directly refute the "never said her name" claim with named-coverage citations.

---

## 2004901730430189831 — VERDICT: genuine_fp

**Tweet:** "French TV show Affronter Votre Pire Cauchemar ('Face Your Worst Nightmare') confronts farmer François Lavigne with 36 singing children dressed as the brother he accidentally killed in a drink-driving accident 10 years prior."

**Our note:** This video shows Serge Gainsbourg in 1988 being surprised by Les Petits Chanteurs d'Asni­ères. There is no farmer François Lavigne and no show called 'Affronter Votre Pire Cauchemar.'

**Current guidance:** PASS only if the bot declines. The post is an obvious ironic-caption meme over a well-known 1988 Gainsbourg clip; comments confirm the joke. Any note solemnly correcting the fake plot summary is a false positive.

**Reasoning:** Our note is factually accurate — Gainsbourg, 1988, children's choir, no farmer. But accuracy alone does not make a note appropriate. The guidance describes a recognized meme format where the absurdist fake caption is the joke, and community raters confirmed this with 39 note-not-needed votes. Earnestly explaining that "there is no farmer François Lavigne" misreads the post as sincere misinformation. The eval is correct.

---

## 2030077895658401996 — VERDICT: genuine_fp

**Tweet:** "'Iran is winning this war, our government is lying to us. This is Tel Aviv right now'" (links to a video clip)

**Our note:** The video shows the "Electronic Arts Presents" logo, identifying it as a video game clip. Fact-checkers debunked the same footage in 2023.

**Current guidance:** PASS only if the bot declines. The clip openly displays "Electronic Arts Presents" — any note earnestly debunking it is a false positive on an overt joke.

**Reasoning:** This is a borderline case — our note's central move (pointing out the EA logo) is actually useful identification. But the guidance's key point is that the EA logo is visible in the clip itself, making the joke self-evident to viewers. The community classified it as note-not-needed. Our note treats as sincere misinformation something the video itself flags as a game. The closer call would be directionally_correct, but the guidance's standard — that the disclaimer is already in the video — is reasonable and not over-strict. The eval is correct.

---

## 2006395901426737233 — VERDICT: genuine_fp

**Tweet:** "The Man Who Refused To Bathe For 60 Years" (links to an animated explainer)

**Our note:** Amou Haji died months after washing, not immediately after. His cause of death was trichinosis from eating raw meat, not the bath itself.

**Current guidance:** PASS only if the bot declines. The tweet's headline claim is true. A note correcting animation-pacing timing is the canonical false positive here.

**Reasoning:** The tweet claims only that Haji refused to bathe for 60 years — a true fact. Our note corrects timing ("not immediately after") and cause of death ("not the bath itself"), but the tweet makes neither claim. The animated explainer may compress time, but the tweet itself never asserts he died immediately or that the bath killed him. Our note introduces and then corrects implications that were not in the original tweet. The eval is correct.

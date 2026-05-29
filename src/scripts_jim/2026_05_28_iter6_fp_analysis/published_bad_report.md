# Eval Audit: published_bad.json — 16 False-Negative Cases

Per-case analysis of whether the eval AI judge's FAIL verdict is fair or too strict.
Verdicts: **(A) EVAL IS FAIR** / **(B) EVAL IS TOO STRICT**

---

## Case 0 — Churchill/Reagan quotes
**URL:** https://x.com/i/status/2055719221812666428

**Verdict: (A) EVAL IS FAIR**

The judge_guidance is explicit: a passing note must address BOTH quotes. The bot's published note addresses only the Churchill misattribution and says nothing about the Reagan quote. The research_brief confirms the bot's pipeline actually found the Reagan quote is authentic (not misattributed), which would have changed the note's framing — but the note still omits it entirely. This is a genuine gap: a reader who shares the meme because of the Reagan quote is left uninformed. The eval verdict is correct.

---

## Case 1 — Ukraine breakthrough March 2026
**URL:** https://x.com/i/status/2038078622590779632

**Verdict: (A) EVAL IS FAIR**

The published note introduces the claim that "Ukrainian forces liberated roughly 400–470 square kilometers… from late January to mid-March 2026." The judge guidance requires the note to establish there was NO breakthrough and NO mass surrender; instead the bot's note partially endorses a Ukrainian territorial narrative to rebut the exaggerated "sudden breakthrough" framing. This is a real problem: the note validates meaningful Ukrainian gains as a counter-narrative, which could still mislead readers about the scale of events. The understandingwar.org URL issue is a secondary concern, but the substantive framing flaw is genuine. Eval is fair.

---

## Case 2 — Two-child benefit cap, 0.8% figure
**URL:** https://x.com/i/status/2009219530300731596

**Verdict: (A) EVAL IS FAIR**

The published note omits "British-born" from the criterion (the 0.8% figure required both parents to be British-born AND work full-time, not merely full-time), and cites only the Labour Press reply on X as its source, which is a partisan source. The eval correctly flags both issues. The note does partially address the misrepresentation but is incomplete and relies solely on a political opponent's rebuttal as evidence.

---

## Case 3 — Ben Stiller / De Niro / Mamdani
**URL:** https://x.com/i/status/2039118807692968130

**Verdict: (A) EVAL IS FAIR**

The published note does correctly state there is no credible evidence of criticism. However, the judge_guidance requires flagging that the De Niro angle traces to a debunked satirical/fabricated post, and requires citing a fact-check like Snopes. The bot instead cites a tweet from Gad Saad (an opinionated commentator, not a fact-checker) and a Wikipedia filmography page. These are weak sources for a "fabricated post" claim. The guidance's requirement to trace the claim's origin to fabrication/satire is a substantive requirement, not a trivial formality — it establishes why there's no evidence (because it was made up), not just that evidence is absent. Eval is fair.

---

## Case 4 — Bessent/Wang Yi Iran tariff fabricated quotes
**URL:** https://x.com/i/status/2049464880520888535

**Verdict: (A) EVAL IS FAIR**

The published note is genuinely weak: "This viral claim of 100% tariffs over Iran oil is false, per Twitter's trending system." Citing Twitter's own trending page as the authority for a fact-check is not credible sourcing. The research_brief contains ample material (Treasury press releases, CNBC, NYT) to write a strong note. The bot chose a lazy citation. The eval verdict is correct.

---

## Case 5 — CBS poll 92.5% Republican approval
**URL:** https://x.com/i/status/2043783331540578439

**Verdict: (B) EVAL IS TOO STRICT**

The note correctly identifies the core falsehood (no such CBS poll exists) and cites Asbury Park Press to establish actual Republican approval at ~85%. The judge_guidance fails this as "repeating the prior note's core weakness of relying on non-primary sources." But the prior note's weakness was citing Wikipedia and Rasmussen, which were flagged as unreliable by raters. Asbury Park Press is a Gannett regional paper that aggregates data from Ballotpedia, RealClearPolitics, and Quinnipiac — it is a meaningfully different class of source. A neutral fact-checker would find this note acceptable: it directly contradicts the 92.5% claim with a realistic figure from a named outlet. The guidance requirement to cite CBS's own polls archive or CNN/Pew primary sources is reasonable as a bonus criterion but should not be a hard FAIL condition when the note already correctly debunks the false figure with a real alternative number from a credible aggregator.

**Current guidance text (failing clause):** "FAIL if the bot just says 'CBS hasn't released this' with only Wikipedia/Rasmussen as supporting links (this is the original note's weakness — raters flagged sources as unreliable)."

**Proposed replacement:** "FAIL if the bot cites only Wikipedia or known-unreliable sources like Rasmussen to contest the poll figure. Aggregator articles from major news outlets (Gannett/AP/USA Today) citing polling averages are acceptable. Preferred but not required: CBS's own polls archive or primary polling organizations (CNN/SSRS, Pew, Gallup, Quinnipiac)."

---

## Case 6 — Stock photo "I beat cancer" (Portuguese)
**URL:** https://x.com/i/status/2048488494243176855

**Verdict: (A) EVAL IS FAIR**

The published note identifies the image as a stock photo from iStock/Getty Images. The judge_guidance requires stating the image is AI-generated (the Freepik source confirms it is a premium AI-generated image, not merely a stock photo of a real child). Misidentifying an AI-generated image as merely a "licensed stock photo" is a material error — it implies a real child was photographed and that photo is being used without authorization, rather than that no real child is depicted at all. These are substantively different corrections. Eval is fair.

---

## Case 7 — Katy Perry Met Gala mask / Stella McCartney
**URL:** https://x.com/i/status/2051895061877870735

**Verdict: (A) EVAL IS FAIR**

The judge_guidance's primary PASS criterion is that the note must identify Miodrag Guberinic as the mask designer, not Stella McCartney, because the entire "surge in orders to Stella McCartney" narrative depends on this misattribution. The bot's note never mentions Guberinic and only addresses the "no surge in orders" half. Correcting only part of a two-part false claim is a genuine failure. Eval is fair.

---

## Case 8 — Steering wheel bumps / Braille hoax
**URL:** https://x.com/i/status/2036122449536811392

**Verdict: (B) EVAL IS TOO STRICT**

The bot's note says the bumps are "tactile markers that help any driver locate the horn without looking… not Braille and are not intended for blind drivers." The eval fails this for omitting the explicit statement that "blind people are not legally permitted to drive." But the note does say the bumps are "not intended for blind drivers" — the practical implication that blind people don't drive is communicated, and the core factual correction (not Braille, purpose explained) is complete. The legal-permission point is the most memorable way to communicate this, but the note is not wrong or misleading without it. A neutral fact-checker reading the published note would find it accurate and informative.

The guidance mandates "(b) notes that blind people are not legally permitted to drive" as a hard requirement, but this is an elaboration of the same underlying point the note does make. Requiring this specific sentence as a pass condition — when the note already conveys "not for blind drivers" — is overly prescriptive.

**Current guidance text (failing clause):** "PASS only if the note (a) states the bumps are NOT Braille (typically tactile grip/texture or assembly markers), (b) notes that blind people are not legally permitted to drive, and (c) cites Reuters, USA Today, or Snopes fact-checks."

**Proposed replacement:** "PASS if the note (a) states the bumps are NOT Braille and explains their actual purpose (tactile grip/horn-locating marker), (b) makes clear blind people do not drive — either by stating it directly or by saying the bumps are 'not for blind drivers' — and (c) cites Reuters, USA Today, or Snopes. A note that says only 'not intended for blind drivers' without citing a fact-check still fails criterion (c)."

---

## Case 9 — Asha Sharma Xbox account "PR bot"
**URL:** https://x.com/i/status/2025496691588104274

**Verdict: (A) EVAL IS FAIR**

The bot's note correctly addresses the "all same date" claim with the multi-date/multi-game evidence. But the judge_guidance identifies the family-sharing explanation as the "single most decisive rebuttal" — and it is right. The family-sharing detail is what Sharma herself publicly gave to explain the elevated gamerscore and anomalous activity pattern, and it directly addresses the "pre-set by Microsoft" insinuation. Without it, the note only rebuts one aspect of the conspiracy claim (the date clustering) while leaving the "newly created, suspiciously high engagement" inference unaddressed. Eval is fair.

---

## Case 10 — Netanyahu death rumor
**URL:** https://x.com/i/status/2033436730251264262

**Verdict: (B) EVAL IS TOO STRICT**

The published note says "Benjamin Netanyahu is alive and held a press conference on March 24, 2026" and cites a Reuters fact-check URL. The eval fails this on the grounds that the March 24 date "conflicts with the reference's established March 12 news conference date, suggesting the URL is likely fabricated or unloadable."

However, the research_brief confirms the Reuters URL is real — it appears in the pipeline's search results with the verifier accepting it as a good source. The verifier successfully fetched the page and reports it says "Netanyahu appeared in front of journalists on March 19, 2026" with opening remarks "I am alive." The eval judge is speculating that the URL is fabricated or unloadable based solely on a date discrepancy in the note text (March 24 cited vs. March 12 referenced in the ground truth). But multiple press conferences happened (March 12, March 19, March 24 are all plausible given the ongoing rumor campaign), and Reuters fact-checked the situation after the event, plausibly publishing their piece on March 24 after verifying the March 12/19 appearances.

The note makes the right claim (Netanyahu is alive, appearances are genuine), cites a real Reuters fact-check, and is accurate. The eval is penalizing the bot for using a slightly later press conference date when the ground truth describes an earlier one — but both point to the same underlying true fact. This is too strict.

**Current guidance text (failing clause):** "FAIL the original note's specific failure: do NOT lean on a Snopes URL or gov.il page without confirming the claim is actually substantiated, and ensure the cited source loads and directly supports that he is alive."

**Proposed replacement:** "FAIL the original note's specific failure: do NOT cite a URL that cannot be verified to load and substantiate the 'he is alive' claim. A note citing any confirmed-loading Reuters, Snopes, NBC, AFP, or Euronews fact-check that establishes Netanyahu's post-rumor live appearances is acceptable regardless of which specific press conference date it references, as multiple genuine appearances were documented in March 2026."

---

## Case 11 — "Wages up, prices down" BLS tweet
**URL:** https://x.com/i/status/2032514777663021439

**Verdict: (A) EVAL IS FAIR**

The eval is correct. The bot's note says "Real average hourly earnings also fell 0.3% over the past year" — but the judge_guidance and ground truth note both state real wages actually rose ~1.4%. This is a factual error in the published note, not merely an omission. The guidance explicitly says do NOT "correct" the wages claim, which is true. The note introduces a false counter-claim. Eval is fair.

---

## Case 12 — Macron/Zelensky dancing deepfake
**URL:** https://x.com/i/status/2012558410122658439

**Verdict: (A) EVAL IS FAIR**

The published note only addresses the Macron clip and says nothing about the Zelensky footage. The tweet explicitly presents both leaders. The Zelensky dancing clips are largely authentic (his pre-presidency entertainment career), so a complete note needs to distinguish: Macron's footage is fake, Zelensky's is real pre-presidency performance footage. By addressing only Macron, the note leaves the misleading "conspiracy" framing about both leaders half-addressed. Eval is fair.

---

## Case 13 — Ivermectin cures Parkinson's/cancer/COVID
**URL:** https://x.com/i/status/2048712783483879812

**Verdict: (A) EVAL IS FAIR**

The published note says only "The FDA has not approved ivermectin for the treatment of any viral infection, including COVID-19." The tweet's headline claims are about Parkinson's and cancer — COVID is the third item. The note addresses only COVID and ignores the primary claims entirely. The judge_guidance explicitly requires addressing Parkinson's and cancer. This is a genuine miss. Eval is fair.

---

## Case 14 — Jeffrey Epstein "spotted in Tel Aviv" AI image
**URL:** https://x.com/i/status/2019501956482367716

**Verdict: (B) EVAL IS TOO STRICT**

The published note correctly identifies the image as AI-generated, cites the Gemini Sparkle watermark, and references Reuters, AFP, and PolitiFact. This directly addresses the primary false claim (the image shows Epstein alive in Tel Aviv). The eval fails it solely for not adding "Jeffrey Epstein died in August 2019."

The implicit claim in the tweet is "Epstein might be alive" — which is fully refuted by establishing the image is AI-generated. A reader who learns the image is AI-fabricated understands there is no real sighting; the "alive" inference collapses. The death-date sentence is a useful addition but the note is not wrong or misleading without it. A neutral fact-checker would find the published note complete.

The guidance's requirement to "reaffirm that Jeffrey Epstein died in August 2019" is reasonable as guidance but should not be an absolute FAIL condition when the note already destroys the "alive" claim at its root (fabricated AI image, confirmed by multiple major fact-checkers).

**Current guidance text (failing clause):** "PASS if the note (a) identifies the image as AI-generated, ideally citing the Gemini Sparkle watermark on the uncropped original and at least one independent fact-check (Politifact, Lead Stories, Misbar, Reuters); and (b) reaffirms that Epstein died in 2019 (ruled suicide by the NY Medical Examiner). REJECT if the note entertains the 'still alive' theory, omits the AI-generation finding, or relies only on partisan/unreliable sources."

**Proposed replacement:** "PASS if the note identifies the image as AI-generated and cites at least one independent fact-check (PolitiFact, Lead Stories, Reuters, AFP). Strongly preferred: also reaffirm Epstein died in 2019, since readers predisposed to conspiracy thinking may dismiss the AI-generation finding. FAIL only if the note omits the AI-generation finding, entertains the 'still alive' theory, or relies only on partisan/unreliable sources."

---

## Case 15 — Fabricated Trump 1998 People Magazine quote
**URL:** https://x.com/i/status/2014434985046921417

**Verdict: (B) EVAL IS TOO STRICT**

The published note says: "People Magazine has confirmed it never published this quote. Fact-checkers including Snopes, Reuters, and the Associated Press have found no evidence Donald Trump ever said Republicans are 'the dumbest group of voters.'"

The eval fails this because "found no evidence" is an equivocating hedge. The guidance says sources are "definitive" and "the note must not equivocate."

This is overly strict. The note opens with "People Magazine has confirmed it never published this quote" — which is a definitive statement. The second sentence uses "found no evidence" about what Trump said, which accurately reflects what can be proven (you cannot prove a person never said something; the strongest claim is that the quote is fabricated and no record exists). The People Magazine statement is the most authoritative possible source and it is stated definitively. Snopes's own language is also "no evidence" — the note mirrors standard fact-checker phrasing accurately.

A neutral fact-checker reading this note would find it clear and accurate. The guidance's objection to "found no evidence" as equivocation ignores that "People Magazine has confirmed it never published this quote" already makes the definitive statement. The "no evidence" clause is about the spoken quote, which is logically correct (absence of evidence of the quote's existence is the finding).

**Current guidance text (failing clause):** "The note must not equivocate ('appears to be fake', 'no evidence found') — sources are definitive."

**Proposed replacement:** "The note must not equivocate with phrases like 'appears to be fake' or 'may be fabricated.' PASS if the note states the quote is fabricated or was never said/published — e.g., 'People Magazine confirmed it never published this' combined with 'fact-checkers have found no record of Trump saying it' is acceptable because the first clause is definitive and the second accurately mirrors the evidence."

---

## Summary

| Verdict | Count | Cases |
|---------|-------|-------|
| (A) EVAL IS FAIR | 11 | 0, 1, 2, 3, 4, 6, 7, 9, 11, 12, 13 |
| (B) EVAL IS TOO STRICT | 5 | 5, 8, 10, 14, 15 |

**5 cases judged too strict (B):**

- **Case 5** (CBS poll): Asbury Park Press (a Gannett aggregator) is a materially different and credible source compared to the Rasmussen/Wikipedia the guidance was actually guarding against.
- **Case 8** (steering wheel Braille): "Not intended for blind drivers" communicates the same point as the required "blind people cannot legally drive." The hard requirement for the specific legal-permission sentence is overly prescriptive.
- **Case 10** (Netanyahu alive): The Reuters URL is real and verified-loading; the eval speculates it's fabricated based on a date discrepancy while the verifier confirmed the page loads and states Netanyahu is alive.
- **Case 14** (Epstein AI image): Correctly identifying the image as AI-fabricated with four major fact-checkers is sufficient to refute the "alive" claim; the death-date sentence is additive but not required for the note to be correct and complete.
- **Case 15** (Trump People quote): "People Magazine confirmed it never published this quote" is a definitive statement; "found no evidence" in the second clause mirrors standard fact-checker language and is not equivocation.

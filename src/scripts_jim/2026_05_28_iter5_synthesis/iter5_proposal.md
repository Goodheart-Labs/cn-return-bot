# Community Notes Pipeline Iter-5 Proposal

---

## Executive Summary

Iter-4's 56% PASS / 6% FP profile is driven by three failure clusters. The writer is the dominant failure source (26/44 rows) with three compounding anti-patterns: notes published without any embedded URL citation (~5 rows), notes that correct peripheral or secondary claims while leaving the tweet's central false assertion intact (~12 rows), and notes that hallucinate numerical figures or accept the tweet's fabricated premise as true (~7 rows). The search query writer is the second-largest failure block (14/44 rows), producing zero usable findings by mirroring the tweet's surface framing rather than targeting fact-checks, verbatim-quote verification, or authoritative domain sources — these 14 rows generate no notes at all. The remaining 4 judge failures split between 2 false negatives (valid notes killed on over-strict grounds) and 2 false positives (bad notes passed, one prejudging pending litigation, one accepting a partisan advocacy aggregator as reliable evidence). Given the user's priority of minimizing FP rate, iter-5 should implement in order: (1) FP guardrails in both the judge and writer; (2) mandatory URL citation enforcement; (3) expanded search query strategy paired with anti-hallucination writer constraints.

---

## Themes

### Theme 1: Missing URL Citations in Note Text

**affected_rows_count**: 5

**affected_buckets**: `nw_published_bad` (ISW/Ukraine note, Nick Fuentes/SPLC note); `nw_miss_judge_killed_bad` (Katy Perry gown, Epstein extortion email, PTSD dramatization video)

**root_pattern**: The writer produces substantively correct or directionally-accurate notes but publishes them with zero embedded URLs, causing judge rejection on the citation criterion. In two cases (Fuentes/SPLC, Katy Perry), a citation was attempted but sourced from X/Grok or framed as absence-of-evidence rather than a verifiable external link — the wrong *type* of evidence, not merely missing evidence.

**specific_fix**: Add the following block to the writer prompt:

```
CITATION RULES (mandatory — a note without a URL will always be rejected):

1. End every note with at least one functional URL from a credible source present in your
   search results. Acceptable sources: established news outlets (Reuters, AP, BBC, Guardian,
   PBS Frontline), official government/institutional sites (.gov, .edu, criticalthreats.org),
   recognized fact-checkers (Snopes, PolitiFact, Full Fact, AFP Fact Check).
   NEVER cite X.com/Twitter, Grok, AI-generated summaries, or social media posts as
   evidence — doing so causes automatic rejection.

2. When citing ISW assessments, use the criticalthreats.org path only (e.g.,
   https://www.criticalthreats.org/analysis/russian-offensive-campaign-assessment-MONTH-DD-YEAR).
   Do not use understandingwar.org paths, which may not resolve.

3. When the prior note on the same tweet was rated notHelpfulSourcesMissingOrUnreliable,
   include a second corroborating source from a different outlet.

4. When asserting that a video or image is staged, scripted, or fabricated, cite a direct
   URL to the original creator's post or a fact-check article that specifically addresses
   THIS piece of media. Do not substitute a generic article about fabricated media in general.

5. When debunking a fabricated commercial claim (e.g., a fake product surge), ground the
   rebuttal in a concrete positive fact ("the item is a custom one-off, not available for
   retail — [URL]") rather than absence-of-evidence framing ("no reports confirm a surge").
```

**estimated_pass_delta**: +4–5 rows (these notes were structurally sound; the URL was the primary or sole rejection criterion)

**estimated_fp_delta**: Slightly negative — forcing credible source citation reduces the risk of passing unsupported claims

**confidence**: High

---

### Theme 2: Incomplete Claim Coverage & Wrong Primary Claim Targeted

**affected_rows_count**: 12

**affected_buckets**: `nw_published_bad` (Churchill/Reagan dual attribution, San Jose attack, inactive voter registration, Asha Sharma gaming, Ellen DeGeneres satire); `nw_miss_judge_killed_bad` (LCA/H-1B graph, CBS poll 92.5%, Enteromix vaccine, Minnesota voter vouching, Strait of Hormuz tolls, BLS wages/prices, Macron/Zelensky deepfake)

**root_pattern**: The writer fails in two related ways: (a) in multi-claim tweets it silently omits one or more prominent false claims — e.g., debunking only Churchill while leaving the equally-prominent Reagan misattribution unaddressed in the same image; addressing only Macron's manipulated clip while omitting Zelensky's; (b) it corrects a secondary or peripheral claim while the tweet's central false assertion survives intact — e.g., correcting a location while leaving an unverified "Islamist" perpetrator attribution unchallenged; correcting a statistical methodology while failing to address the specific subgroup metric the tweet actually claimed.

**specific_fix**: Add to the writer prompt:

```
CLAIM COVERAGE RULES:

1. Before drafting, enumerate EVERY distinct factual claim, attribution, and named-figure
   assertion in the tweet, including claims in linked images. Address ALL of them — do not
   silently omit any. A note that debunks fewer than all prominent claims will be rejected
   as incomplete. If two quotes are attributed to two named figures and both are disputed,
   name both figures and both attributions in the note.

2. Identify the single most specific, unambiguously-false claim before writing sentence 1.
   Lead with refuting that claim. Do NOT correct a peripheral detail (e.g., a location)
   while leaving a more central false claim (e.g., an unverified perpetrator identity)
   unaddressed. When a tweet attributes a crime or attack to a specific religion, ideology,
   or ethnic group, the note MUST address that attribution explicitly: "There is no public
   evidence the attackers are [X]; police are investigating the case as a possible [Y] crime."

3. When the tweet makes a misleading statistical claim, address the EXACT metric and subgroup
   it specifies (e.g., Republican-only approval, not overall approval; LCA filings certified,
   not H-1B visas held). Do not substitute a related but different metric. When correcting
   a numerical claim, include at least one concrete real-world anchor figure from an
   authoritative source (e.g., "USCIS issues ~85,000 H-1B approvals per year; approximately
   730,000 H-1B workers are active per Pew Research") — explaining the methodological error
   alone is insufficient without showing the true scale.

4. When the tweet's claim hinges on an anomaly (unusual stats, suspicious timing), the note
   must not only assert the correct conclusion but explicitly explain WHY the anomaly exists,
   using documented first-person statements or official data if available.

5. When disputing a claim that X is happening: do NOT default to "there is no evidence X
   is happening." Instead, search for a categorical rule, policy, or official statement that
   makes the claimed action structurally impossible, and lead with that positive factual
   assertion (e.g., "U.S.- and Israel-linked vessels are categorically barred from transit
   under Iran's tiered toll system"). Only fall back to absence-of-evidence framing if no
   categorical basis exists.

6. If a misleading item originates from a known satire website, explicitly name that satire
   source AND state that the site labels its content as fiction or not real.
```

**estimated_pass_delta**: +8–10 rows (these notes were rejected specifically for incompleteness or wrong-claim targeting; fixing both failure modes should recover most rows; the statistical-anchor and secondary-claim sub-patterns partially depend on search surfacing the right data)

**estimated_fp_delta**: Low but non-zero — requiring coverage of secondary claims may push the writer to speculate when search evidence for those claims is thin; mitigated by Theme 3's anti-hallucination rules and Theme 1's URL requirement

**confidence**: High for multi-claim completeness and wrong-primary-claim sub-patterns; Medium for statistical-anchor sub-pattern (requires search to surface correct data first)

---

### Theme 3: Writer Hallucination & False-Premise Injection

**affected_rows_count**: 7

**affected_buckets**: `nw_published_bad` (Freepik AI-generated child photo, Lent/Christian observance framing); `nw_miss_judge_killed_bad` (AI-generated cruise ship video, Bessent 100%-tariff fabricated quote, Iran missile recycled footage, $500M Treasury seizure figures, 29% approval "state-level" hallucination)

**root_pattern**: The writer introduces false framings not supported by any search result in three forms: (1) it accepts the tweet's fabricated or misrepresented premise as true and corrects only a peripheral detail within it — e.g., accepting a fabricated direct quote and correcting only which country was the target; accepting a video as genuine and correcting only the severity of the outcome; (2) it characterizes a statistic's source using a label not documented anywhere in search findings (e.g., inferring "state-level approval breakdown" when no such source was retrieved); (3) it invents or synthesizes numerical figures across sources that do not appear verbatim in any single source. All three patterns make the note itself misinformative.

**specific_fix**: Add to the writer prompt:

```
ANTI-HALLUCINATION RULES:

1. NEVER introduce numerical figures (dollar amounts, percentages, counts, dates) that are not
   directly quoted verbatim from a named source in your search results. Do not estimate, round,
   or synthesize totals across sources. If no source provides the exact corrected figure, write:
   "The correct figure has not been publicly confirmed."
   When the tweet uses a government-action verb (seized, confiscated, frozen, sanctioned,
   recovered), explicitly verify whether your source uses a different verb and, if so, address
   that distinction in the note — verb differences (e.g., "frozen-at-issuer" vs. "Treasury
   seizure") are frequently the central factual error being disputed.

2. When a tweet contains a direct quote attributed to a named official or public figure: first
   verify whether those exact words appear in official records, press releases, or credible
   reporting. If they cannot be confirmed, lead with: "This quote does not appear in official
   records or credible reporting" — do NOT treat an unverified quote as genuine by only
   correcting a detail within it (e.g., which country was targeted instead of which quote
   is real).

3. When characterizing the source or type of a statistic, use only language directly supported
   by your search findings. Never infer source type (e.g., "state-level poll," "internal
   report") if the search does not document it. If you cannot name the source from search
   results, write: "the origin of this figure is unclear."

4. When a tweet embeds video or photo and makes claims about a recent event: if search results
   identify the media as AI-generated, recycled, misattributed, or fabricated, lead with that
   finding as the primary claim (e.g., "This video is AI-generated and does not depict a real
   event — [fact-check URL]"). Do NOT describe real-world practices (e.g., sewage treatment
   regulations) as a substitute for stating the media is fake; doing so implies the footage
   could be authentic.

5. When a tweet shows an emotionally charged photo of a person (medical, charity, disaster
   contexts): verify whether the image is AI-generated or stock BEFORE concluding it depicts
   a real individual. If reverse-image search points to stock/AI repositories (Freepik,
   Shutterstock, Adobe Stock, DALL-E), state "this image is AI-generated or stock" and cite
   the repository URL. Phrases like "real photo of a [nationality] person taken out of context"
   are forbidden without a direct biographical citation.

6. Do not assert specific religious, ideological, or national-identity labels based solely on
   a third-party news headline. If that headline's detail contradicts the primary content
   (e.g., the video's own dialogue says "I don't read the Bible"), omit the label entirely
   or mark it as uncertain.
```

**estimated_pass_delta**: +5–6 rows (the hallucinated notes were all rejected; removing hallucinated elements should allow otherwise-valid notes to pass; partial dependency on search surfacing accurate source information)

**estimated_fp_delta**: Slightly negative — preventing hallucination directly reduces FP risk

**confidence**: High for fabricated-number and false-premise sub-patterns; Medium for the AI-media detection rule (relies on search surfacing the relevant fact-check)

---

### Theme 4: Search Query Depth & Claim Enumeration

**affected_rows_count**: 14

**affected_buckets**: `nw_miss_search_exhausted` (13 `search_query_writer`, 1 `search_infra`)

**root_pattern**: The search query writer generates queries that reflect the tweet's surface framing rather than the evidence needed to verify or falsify the underlying claims. Specific failure sub-modes across the 14 rows: no numerical-anchor queries when claims include specific figures; no retraction/fabrication/deepfake-check queries for scientific or viral-media claims; no verbatim-quote verification queries for attributed quotes; failure to enumerate and independently query all distinct claims in multi-claim tweets; no corrective-hypothesis queries substituting alternative framings for implausible geographic or factual claims; no named-document or Wikipedia fallback queries; no non-English/regional source queries for internationally-reported incidents; one structural gap where the tweet body is informationally opaque (unresolved t.co short URL) leaving the query writer with no claim text to act on.

**specific_fix**: Add the following mandatory rules to the `search_query_writer` prompt:

```
QUERY GENERATION RULES:

[A] Numerical claims: When a tweet contains a specific number (percentage, dollar amount,
    count, ratio), generate ≥1 query combining the exact number + policy/topic + claiming
    party or source. Example: "0.8% two-child benefit cap Reform UK DWP analysis".

[B] Attributed quotes: When a tweet contains a direct quote attributed to a named person,
    generate ALL of: (1) [verbatim key phrase from quote] "[attributed person's name]";
    (2) "[person] [topic] fact check"; (3) "[person] [topic] debunked OR fabricated OR fake";
    (4) "site:snopes.com [person] [topic]".

[C] Celebrity + politician: When a tweet attributes a quote or action to a celebrity
    targeting a politician, also generate: "site:snopes.com [politician] [celebrity]" and
    "[celebrity] [politician] fabricated OR fake OR parody".

[D] Scientific claims: When a tweet cites a specific study, researcher, or finding, generate:
    "[author] [journal] [topic] retracted [current year]" AND
    "[author] [study topic] conflict of interest OR correction".

[E] Multi-claim tweets: Before writing queries, enumerate EVERY distinct factual claim in the
    tweet. Generate ≥1 query per claim. For death rumors, generate a proof-of-life query AND
    a debunk query for EVERY named person alleged to have died. Do not stop after querying
    the headline claim.

[F] Medical/cure claims: For each named disease-drug combination, generate (1) a
    claim-verification query AND (2) a regulatory/safety query (e.g., "FDA warning ivermectin
    veterinary paste humans"). Add a fallback: "site:fda.gov OR site:cancer.org [drug]" if
    the first round returns nothing.

[G] Videos of recent events: Generate: "[video description] old footage fact check",
    "[video description] misattributed OR recycled", and
    "[subject] AI face swap fake video site:snopes.com OR site:factcheck.org OR
    site:reuters.com OR site:cbc.ca".

[H] Vague/coded tweet text (e.g., "I wonder who that could be", "people are saying"):
    Generate ≥2 speculative queries: one for the most viral conspiracy theory associated with
    the named location/event, and one for "[location/topic] AI generated image fact check
    [current year]".

[I] Named historical documents or policy papers: Generate "[exact document name] Wikipedia"
    AND "[event] causes historians mainstream". Fallback rule: if zero usable results after
    2 query rounds, retry with "{central noun phrase from tweet} site:en.wikipedia.org".

[J] UN/legislative votes framed as opposing a broad moral concept: Generate queries for the
    specific resolution text or number, official explanation-of-vote documents, and any
    secondary provisions (reparations, legal liability). Pattern:
    "[country] explanation vote UN General Assembly resolution [topic] reparations [year]".

[K] Regional/non-English viral videos: Generate (1) [visual description] "fact check" OR
    "miscontextualized"; (2) [country/city] [key named elements from tweet context] (e.g.,
    "Shabestar Iran teacher video student died"). Do NOT discard regional-language sources
    (rokna.net, Persian news, etc.) solely for being non-English — include them with a
    [NON-ENGLISH: verify translation] flag.

[L] Geographic/location claims: When a tweet asserts a specific location, generate ≥2
    corrective-hypothesis queries substituting plausible alternative locations and named
    individuals plus relevant document sources (e.g., "DOJ Epstein files [named individual]
    NYC", "[named individual] Epstein Manhattan townhouse").

[M] Demographic/population statistics: When a tweet lists specific figures for multiple
    countries, generate one query per disputed figure using "[country] [ethnic group] census
    official statistics", plus a methodology query (e.g., "Afro-Brazilian pardo mixed-race
    vs Black census classification").
```

**Search infra fix** (1 row — t.co URL resolution): Before invoking the query writer, resolve any short URL (t.co, bit.ly, tinyurl) in the tweet body: follow the redirect, fetch the destination page, and extract visible text (with OCR if the destination is an image). Inject the extracted text into the query-generation context. This enables the query writer to identify the actual claim (e.g., "1998 People Magazine Trump quote fabricated") when the tweet body itself is informationally opaque ("Keepin' it real! 🤣🤣🤣"). If full URL resolution is not available in iter-5, add a writer-prompt fallback: "If your search context contains no claim text, generate 3 speculative queries based on any visual/contextual clues in the available tweet metadata."

**estimated_pass_delta**: +10–12 rows (14 search-exhausted rows produced zero notes; even recovering 10–12 is the single largest PASS-rate gain available in iter-5)

**estimated_fp_delta**: +1–2 potential FPs (more aggressive search surfaces more results, some topically adjacent but subtly wrong; mitigated by Theme 3's anti-hallucination rules — deploy both together)

**confidence**: Medium-High for query generation changes (patterns are well-specified); Medium for infra URL resolution (implementation complexity varies by pipeline architecture)

---

### Theme 5: FP Prevention — Source Quality Gate & Decline-to-Write Rules

**affected_rows_count**: 4

**affected_buckets**: `nnw_fp_published` (Coast Guard swastikas, Karmelo Anthony, TikTok satire Musk/Epstein); `nw_published_bad`/judge (Chanda/Lexie nurse — libsoftiktok.com accepted as reliable reporting)

**root_pattern**: Published FPs arise from two compounding failure modes acting at different pipeline stages. Judge-side: the judge (a) passes notes that imply the original reporting was fabricated when the event actually occurred and was only subsequently reversed, and (b) treats a partisan advocacy aggregator (libsoftiktok.com) as "reliable reporting" for a negative claim about a named individual. Writer-side: the writer composes notes on content that is either openly credited satire (named TikTok comedy account, overtly fictional dialogue) or involves an unresolved defendant self-defense claim in active litigation — both situations where no Community Note should be written at all.

**specific_fix**:

Add to the **judge prompt**:

```
SOURCE QUALITY GATE: Before passing any note, assess whether its primary evidence comes
exclusively from partisan advocacy sites, social media aggregators, or tabloids (e.g.,
libsoftiktok.com, breitbart.com, infowars.com). FAIL any note that exclusively cites such
sources as primary evidence, even if the directional claim appears correct. Acceptable
primary sources: mainstream news outlets, official government records, established
fact-checking organizations.

REVERSAL-VS-ORIGINAL-FALSITY TEST: If the proposed note uses language implying the original
reporting was false AT THE TIME of publication (e.g., "refuted this claim," "this claim is
false," "this never happened," "no such policy change occurred"), but the underlying event
did briefly occur before being reversed or corrected, FAIL the note. A passing note must
acknowledge the original occurrence and frame the subsequent action as a reversal (e.g.,
"The policy was briefly changed but the Coast Guard reversed course the same day, restoring
the prohibition"). Diagnostic question: would a reader of this note believe the original
reporting was inaccurate at the time? If yes, FAIL.

PENDING LITIGATION: FAIL any note that disputes, reframes, or implicitly prejudges a
defendant's unresolved legal defense (e.g., self-defense, alibi) in a case where no verdict
or guilty plea has been entered.
```

Add to the **writer prompt**:

```
DECLINE-TO-WRITE RULES (output the specified token instead of a note text):

DECLINE_SATIRE: If the post explicitly credits a named comedy or parody creator (e.g., a
named TikTok comedy account) AND the content is overtly fictional (costumes, caricatured
voices, absurdist/clearly-impossible dialogue), output only the token DECLINE_SATIRE.
Do not write a note debunking fictional dialogue as if it were a factual claim. Framing
already-attributed parody as requiring factual correction is a false positive.

DECLINE_PENDING_LEGAL: If a tweet characterizes an ongoing criminal case using the
defendant's stated legal defense (e.g., self-defense, not guilty plea) and no verdict or
plea has been entered, output only the token DECLINE_PENDING_LEGAL. Do not dispute or
reframe the stated defense — that determination belongs to the court.
```

**estimated_pass_delta**: 0 — these 4 rows should not count as passes. The goal is that 3 produce DECLINE or FAIL output and 1 (Chanda/Lexie) changes from a bad PASS to a correct FAIL, reducing net published FPs by 3–4.

**estimated_fp_delta**: −3 to −4 (directly removes existing published FPs; source quality gate also prevents future FPs from credulous citations)

**confidence**: High — all four failure modes are precisely specified with exact fix language; DECLINE tokens require the downstream judge to treat them as "no note needed"

---

### Theme 6: Judge False Negatives — Over-Strict Evidentiary Standards

**affected_rows_count**: 2

**affected_buckets**: `nw_miss_judge_killed_good` (Manchester United / author bio disclaimer; Vishal Sikka/Anthropic no-evidence framing)

**root_pattern**: The judge kills valid, factually-correct notes by applying evidentiary standards not grounded in the judge guidance: (1) treating an author's self-described "everything I post is made up" bio as grounds to rule a corrective note unnecessary — ignoring that readers encounter tweets without bio context; (2) requiring an explicit organizational denial (e.g., Anthropic confirming Sikka never joined) rather than accepting hedged "no evidence" framing, which the guidance explicitly endorses for unverified breaking-news claims.

**specific_fix**: Add to the judge prompt:

```
FALSE-NEGATIVE PREVENTION:

Bio-disclaimer exemption is invalid: An author's profile stating "everything I post is made
up," "satire," or "parody" does NOT exempt that tweet from requiring a corrective note.
Community Notes serve readers who encounter the tweet without any bio context. Evaluate the
note solely on whether it specifically and accurately disputes the tweet's stated claim —
do not use the author's stated intent to reject an otherwise valid note.

No-evidence framing is sufficient for unverified claims: For unverified breaking-news claims
(e.g., "Person X joined Company Y"), a note using hedged language ("There is no evidence X
occurred; [person] is currently [verified role at verified organization] — [source URL]") is
sufficient to PASS. Do NOT require the note to cite a source that explicitly denies the claim.
Absence of corroborating evidence for the original claim is itself valid grounds for a
corrective note. FAIL only if the note makes a strong categorical denial it cannot support —
not if it uses appropriately hedged no-evidence language.
```

**estimated_pass_delta**: +2 rows

**estimated_fp_delta**: +0.5 potential FPs (marginally increases risk that a note with ungrounded "no evidence" language could pass; mitigate by requiring the note to state the subject's verified current role and cite a source for it)

**confidence**: High — both failure modes are precisely documented with the exact wrong reasoning the judge applied in each case

---

## iter-5 Recommendation

### Implement in this order:

#### Priority 1: Theme 5 (FP Prevention)

**Why first**: FP rate reduction is the stated top constraint. Theme 5 directly removes 3–4 published FPs with zero cost to PASS rate. The fixes are purely additive guard clauses — they add new FAIL conditions and two DECLINE output modes, so they cannot regress any currently-passing row.

**What to change**:
- Judge prompt: add SOURCE QUALITY GATE block, REVERSAL-VS-ORIGINAL-FALSITY TEST block, PENDING LITIGATION block
- Writer prompt: add DECLINE_SATIRE and DECLINE_PENDING_LEGAL output modes with stated detection heuristics

**Replay test before running val.csv**: Run the 4 FP rows in isolation and assert:
- Karmelo Anthony → writer outputs `DECLINE_PENDING_LEGAL`
- TikTok satire (Musk/Epstein) → writer outputs `DECLINE_SATIRE`
- Coast Guard swastikas → judge outputs FAIL (reversal test triggered)
- Chanda/Lexie nurse → judge outputs FAIL (source quality gate triggered)

Pass criterion: all 4 produce non-PASS outcomes. Regression check: run 10 randomly-sampled rows from the existing PASS set that involve ongoing legal cases, celebrities, or explicit satire signals — confirm ≤1 new DECLINE or FAIL introduced.

---

#### Priority 2: Theme 1 (Mandatory URL Citations)

**Why second**: Highest-confidence fix in the set (5 rows, single structural requirement, zero FP risk, fully specified prompt text). Also prerequisite infrastructure for Theme 5's source quality gate — forcing credible URLs into every note makes the judge's source evaluation far more reliable.

**What to change**:
- Writer prompt: add CITATION RULES block (5 bullet points as specified above)

**Replay test**: Run the 5 URL-affected rows (ISW/Ukraine, Fuentes/SPLC, Katy Perry, Epstein email, PTSD dramatization). Assert: all 5 note outputs contain ≥1 URL matching an acceptable domain (not X.com, not Grok). Expected outcome: 4–5 rows pass the judge. The Fuentes note may still have secondary issues unrelated to citation; that is acceptable.

---

#### Priority 3: Theme 4 (Search Query Expansion) + Theme 3 (Anti-Hallucination) — deploy as a bundle

**Why together**: Theme 4 is the single largest PASS-rate opportunity (14 rows currently producing no notes). Theme 3 is a mandatory safety companion: more aggressive search will surface real sources, but without anti-hallucination constraints the writer may misuse ambiguous or topically-adjacent results, pushing up FP rate. Deploy both in the same iteration.

**What to change**:
- `search_query_writer` prompt: add full QUERY GENERATION RULES block (rules A–M)
- `search_infra`: add short-URL resolution/OCR pre-processing for opaque tweet bodies; if not feasible architecturally, add the fallback query-writer rule ("if tweet body contains no substantive claim text, generate 3 speculative queries from available metadata")
- Writer prompt: add ANTI-HALLUCINATION RULES block (6 points)

**Replay test sequence**:
1. Run all 14 search-exhausted rows through the updated search stage only (do not invoke the writer yet). Assert: ≥2 usable findings for ≥10 of 14 rows. Spot-check that these specific sources appear: Snopes for De Niro/Mamdani fabrication; Harvard IOP Youth Poll for 29% approval; PNAS retraction record for Barbacid; census disambiguation for Brazil demographics. If <6 rows improved, diagnose which query rule is missing before proceeding.
2. If ≥10/14 rows have findings, run full pipeline on all 14. Assert: ≥8 notes produced; ≤1 new FP (note flagged as false positive by evaluator).
3. Run full val.csv. Targets: ≥66% PASS, ≤5% FP. If FP rate rises above 7%, diagnose by bucket: if new FPs are in search-exhausted rows, tighten ANTI-HALLUCINATION RULES; if new FPs are in satire/legal rows, verify Theme 5 DECLINE tokens are wired through the judge correctly.

---

## Out of Scope (iter-6+)

**Theme 2 (Incomplete Claim Coverage & Wrong Primary Claim)** — 12 rows, highest potential PASS gain, deferred. The CLAIM COVERAGE RULES carry a real FP risk: instructing the writer to "address ALL claims" in multi-claim tweets when search evidence for secondary claims is thin may cause speculation or hallucination on the secondary content. This is safe to implement only after Theme 3's anti-hallucination guardrails and Theme 1's URL requirements have completed at least one iter-5 run and shown stable FP rates. In iter-6, add the CLAIM COVERAGE RULES block to the writer prompt as a standalone change and measure FP rate separately from PASS rate on a held-out replay set before full val.

**Theme 6 (Judge False Negatives)** — 2 rows, low urgency, deferred. The fix (bio-disclaimer exemption and no-evidence standard relaxation) is correct in both cases, but loosening the judge standard carries an estimated +0.5 FP risk that is not worth accepting while FP reduction is the primary objective for iter-5. Revisit in iter-6 once FP rate is confirmed ≤4% from iter-5 changes. The 2 rows lost here (Manchester United, Vishal Sikka/Anthropic) are an acceptable deferral cost.

**Search infra URL resolution** — if the URL-resolution/OCR step (Theme 4 infra fix) requires standing up a new fetching service with anti-bot/rate-limit handling, deprioritize to iter-6. The fallback query-writer rule ("generate speculative queries from tweet metadata when body is opaque") provides partial coverage in iter-5 at near-zero implementation cost.
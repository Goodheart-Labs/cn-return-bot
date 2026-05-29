# Judge REJECT principles (distilled from the FP-mining catalog)

Distilled from four catalog sections of crowd-rejected notes (`no_note_needed`,
`incorrect_speculation_biased`, `missing_key_points`, `sources_and_misc`). The
catalog stores concrete dataset exemplars; **this file is the abstraction** —
general rules for the note-needed judge, with no eval-specific tweets, so it can
inform the production prompt without overfitting the valset.

**Core principle:** a note's only job is to correct a *false factual belief a
reader would otherwise form*. It is not a tool to police tone, label the
obvious, win an argument, resolve an opinion, or repeat the post. A note that
introduces a new error, leaves the central falsehood standing, or rests on a
source that doesn't load-and-prove the claim is worse than no note — it trains
raters to distrust the system.

---

## A. No note is warranted (the post gives nothing to correct)

1. **No checkable fact.** Opinion, value judgment, legal/rhetorical framing,
   vague generalization, or an unfalsifiable motive/mind-reading claim
   ("he did X *so that* Y"). No discrete past/present fact to pin down → no note.
2. **Satire / joke / obvious hyperbole / self-evident fiction.** Read from the
   post itself (and whether the room is in on it), not a bio label. Don't
   fact-check a punchline, a clearly fantastical image, or content the post
   already labels (AI watermark, "made with AI", parody disclosure). The
   correction states the obvious and signals the writer missed the tone.
3. **Pedantry.** A minor detail (wrong agency vs. colloquial usage, a rounding
   error, a one-month discrepancy, self-promotional branding) that doesn't
   change the post's meaning or create a false belief. *Exception:* a false
   superlative/absolute the post asserts outright ("first ever", "none",
   "no ID required") IS a checkable claim, not pedantry.
4. **Private / unverifiable anecdote.** A first-person or private-individual
   statement CN cannot verify or falsify. A note here fabricates the impression
   that the system checked and disproved a personal memory.
5. **Strawman — claim never made.** The note rebuts an implication, a question
   posed ("Is the CIA behind…?"), or a different framing rather than the post's
   actual assertion. Notes are for stated false claims, not insinuations.

## B. The proposed note is itself defective (reject even if a note *could* be warranted)

6. **Note is wrong / introduces a new falsehood.** Verify before flagging — the
   post may be accurate and the note the misinformation. Don't replace one false
   attribution with a second false one, fabricate a plausible-sounding mechanism,
   misidentify the document/species/source, or accept a fabricated premise and
   "fix" a peripheral detail inside it (that reinforces the hoax).
7. **Speculation/inference stated as fact.** "No evidence" verdicts, asserted
   technical causes ("it's just lighting"), or motive rebuttals with no sourced
   alternative read as the writer's editorial opinion. State only the checkable
   record; supply the *actually-reported* reason, don't just negate the false one.
8. **Note repeats / confirms the post.** If it restates the post's claim (same
   attribution, same scope) and adds unrequested reassurance, it corrects nothing.
9. **Misses the central claim.** Rebutting a peripheral detail while the core
   false implication survives; debunking an illustrative photo in a way that
   implies a *real* underlying event is fake (must affirm what's confirmed);
   naming the event but omitting the one explanatory fact that dissolves the
   alarming visual; attacking credentials/process instead of the post's actual
   categorical overstatement.
10. **Structure undercuts the correction.** Leading with a concession that
    validates the misleading framing before burying the rebuttal — the
    correction must come first and be unambiguous. No editorial/partisan asides
    appended to a neutral debunk.
11. **One-sided framing on a genuinely contested event.** Presenting the
    official/opposing/interested account as settled fact where the matter is
    truly disputed. (Distinct from #7: here independent verification is *absent*,
    not merely uncited.)

## C. Sourcing (the citation must load and prove *this* claim)

12. **Sources must independently substantiate the specific claim.** Reject:
    anonymous social-media posts as evidence; Grok/AI-generated output as a
    primary source; a public figure's profile page or a journalist's topic-index
    instead of the dedicated debunk; an interested-government event page for an
    extraordinary claim (death hoax) where skeptics will challenge it; and a
    citation that covers a *different* event than the note's provenance claim
    ("this is the 2020 X video" linked to sources about the 2026 event).

---

### Where the production judge already covers this vs. gaps

`src/pipeline/simple-bot/judge.ts` already encodes **A1–A5** well (its three
preconditions + abstain list: opinion/prediction, satire/comedy, pedantry,
self-disclosed, strawman). Its weak spot is **bucket B** — the note-quality
checks. The judge currently asks "should a note exist?" but barely asks "is
*this* note correct, complete, and well-structured?", which is exactly where the
`nw_published_bad` / `nnw_fp_published` rows leak through. B6–B11 + C12 are the
candidate additions for the next judge iteration.

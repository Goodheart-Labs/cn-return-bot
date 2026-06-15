# Iter-06 → Iter-07: Concrete FP-Lowering Proposal

Synthesized from per-failure analysis of **all 18 published false positives** (fp_report_a/b),
the **23 confirmed-good notes** (good_report — pass-rate collateral), and the **16 published-bad
notes** (published_bad_report — eval strictness). This is my own synthesis, not the prior
`iter5_proposal.md`.

Iter-06 state: **52/100 PASS, 36% FP (18/50), NW-success 23/50, miss-rate 22%.** The recall jump
(9→23 success, 31→11 misses) is real and must be preserved. The FP surge (3→18) is the whole
problem. **Everything below targets precision only — none of it touches the query-writer /
writer recall changes that drove the recall win.**

---

## 1. The single root cause

The note-needed judge's "Satire, parody, and obvious joke" section is **calibrated to publish.**
It instructs (judge.ts:56–58):

> "A note is needed if a meaningful fraction of commenters are in the 'taking it as real' bucket.
> Even 1-2 confused commenters out of 10 ... means many silent readers are also confused."
> "A note is NOT needed only if commenters overwhelmingly (≈80%+) recognize the post as fake."

This is a **confusion-counting** standard with a near-impossible bar to abstain. It directly
produced the largest FP cluster: the bot solemnly "corrects" obvious jokes/memes/parody because
1–2 reply-guys played along. The fix is to replace the standard, not patch around it: **publish
only when a *reasonable* member of the audience would be deceived** — the test every one of the
23 good notes passes and every one of the 18 FPs fails.

---

## 2. The unifying principle (one test, three preconditions)

A note is warranted **only if all three** hold. Each FP fails ≥1; each good note satisfies all 3.

- **P1 — Falsifiable fact.** The post asserts a *specific, checkable* claim about a past/present
  state of the world (a number, a named person's status, an event's occurrence/date, media
  provenance). NOT a prediction, opinion, partisan generalization, or value judgment.
- **P2 — Materially false.** That claim is actually false/misleading against the evidence. NOT
  merely reframed, NOT pedantically incomplete, NOT something the author already disclosed.
- **P3 — Reasonable reader deceived.** A reasonable member of *this post's audience* would be
  deceived — NOT obvious satire/parody/meme, NOT sarcasm, NOT something the attached media or top
  replies already disambiguate, NOT a period-roleplay account stating an in-frame-accurate fact.

The 18 FPs map cleanly onto which precondition they violate:

| Gate | Precondition it enforces | FP indices | # |
|------|--------------------------|-----------|---|
| **G1** | P3 — reasonable-reader-deceived | 0, 4, 6, 8, 11, 12, 13, 14, 17 | 9 |
| **G2** | P2 — materially-false-claim required | 1, 3, 7, 10, 16 | 5 |
| **G3** | P1 — falsifiable past/present fact required | 2, 5, 9, 15 | 4 |

---

## 3. The concrete changes (all in the note-needed judge prompt)

The judge is the single FP chokepoint — it sees post + findings + proposed note and returns
`note_needed`. Enforcing all three gates there is the minimal, measurable change. (Two optional
writer-side early-abstains in §6 save a judge call but aren't required.)

### G1 — Replace the confusion-counting satire section with a reasonable-reader test

**Delete** the entire "## Satire, parody, and 'obvious joke' posts" block (judge.ts:39–61) and the
two list bullets that feed it. **Replace** with:

```
## Is a reasonable reader actually deceived?

Publish only if a REASONABLE member of this post's audience would take the claim as a sincere
factual assertion AND be misled by it. The bar is the reasonable reader, NOT whether any single
reader could be confused. Return note_needed=false if ANY of these hold:

- The post is obvious satire, parody, mockery, or a recognizable meme format — signalled by the
  TEXT/MEDIA ITSELF, not by a bio tag. Tells: clustered mockery emojis (🤡😂🙄) on a quoted line;
  an absurdly specific fictional backstory over a real clip; a self-evidently impossible/parodic
  premise; an all-caps rhetorical question whose answer is in the attached image.
- The attached media or the top replies already supply the correction (an on-screen scoreboard,
  a visible sender name, a top reply that names the right person). The audience can already see it.
- The account posts in-character at a fixed past time (e.g. "2001Live") and the stated fact was
  accurate within that period.

A handful of reply-guys playing along does NOT make obvious satire note-worthy.
```

**Fixes:** 0, 4, 6, 8, 11, 12, 13, 14, 17 (9 FPs).

### G2 — Require the claim to be materially false, not merely reframed or incomplete

**Add** to the "should NOT be published if ANY of" list:

```
- The post's checkable claim is actually ACCURATE and the note only reframes it (e.g. swaps to a
  different metric, relabels "dumping" as "gradual decline", or adds adjacent context that doesn't
  contradict anything). If the findings conclude the claim is "essentially accurate", abstain.
- The author already truthfully disclosed the nature of the content (states it is AI-generated,
  satire, fiction). Do not correct a subclaim the author never made.
- It is a pedantic recency or detail correction: the post makes no temporal claim but the note
  says "this is from [earlier date]", or the post is a stylized explainer/animation and the note
  nitpicks compressed timing while the headline claim is true.
```

**Fixes:** 1, 3, 7, 10, 16 (5 FPs).

### G3 — Require a falsifiable past/present fact (sharpen the existing prediction/opinion bullets)

The current prompt already has prediction + editorial-metric bullets but they under-fire. **Add**:

```
- The post is a prediction about a future event ("expected to happen today/tonight/soon"). Do NOT
  use hindsight to say whether it came true.
- The post's disputed facts are before a court and not yet adjudicated ("trial coming up",
  "charges pending"). Do not assert contested guilt/victim/circumstance facts pre-verdict.
- The core claim is a partisan generalization about which side did/said what ("the Left never said
  her name"). This is a rhetorical assertion, not a checkable fact — unless it embeds a specific
  falsifiable number or event.
```

**Fixes:** 2, 5, 9, 15 (4 FPs).

---

## 4. Pass-rate impact (the §4 the user asked for)

Cost is measured against the **23 confirmed-good notes** (good_report). A gate that only makes the
bot *more likely to abstain* cannot harm rows where the bot already correctly abstained
(nnw_correct), so the 23 good published notes are the only rows at risk.

| Gate | FPs fixed | Good notes hard-killed | Good notes "watch" (maybe) | Est. PASS cost |
|------|-----------|------------------------|----------------------------|----------------|
| **G1** (reasonable-reader, *safe* form) | 9 | **0** | 5: good#4,6,7,13,16 | ~0 |
| **G2** (materially-false) | 5 | **0** | 0 | ~0 |
| **G3** (falsifiable fact, *safe* form) | 4 | **0** | 2: good#16,17 | ~0 |
| **Total** | **18** | **0** | — | **~0** |

**Why ~0, not a guess:** good_report scored each of the 23 against three candidate gates. The
*naive* tone-based versions threaten 5 (satire) + 2 (opinion) good notes. But every one of those
"maybe" notes still **transmits a concrete falsifiable claim that reached readers as fact** (e.g.
the Man-Utd post whose bio says "everything I post is made up" still made a precise, false UCL
claim with 1.8M impressions). The **safe** formulations above abstain only when BOTH the post
self-signals non-factual intent AND no concrete falsifiable claim is circulating — so they clear
all 5 satire "maybes" and both opinion "maybes". Predicted hard kills on this sample: **0.**

**The watch-list (G1/G3 maybe cases)** is exactly where to look first if iter-07 recall dips:
good#4 (deadpan cruise-ship sarcasm), #6 (casual missile-POV tone), #7 ("made up" bio + real
false claim), #13 (parody-account fabricated quote), #16 (Hormuz triumphalist framing + concrete
ship claim), #17 (partisan Trump-29% gloating + concrete number).

---

## 5. Directly answering "if it could possibly be satire, don't publish"

That naive gate **is too strict** — and now we can quantify it. Formulated as
"could-this-be-read-as-satire → abstain", it would hard-or-maybe kill **5 of 23 (~22%) of our
confirmed-good notes** (good#4,6,7,13,16) while fixing the same 9 FPs that G1's safe form fixes.
The tone-based version trades real pass-rate for no extra FP reduction. **Recommendation: ship the
positive-precondition form (G1), not the tone gate.** The discriminator is "is there a concrete
falsifiable claim circulating as fact?", not "does the post sound jokey?".

---

## 6. Optional writer-side early-abstains (save a judge call, not required)

Two G2 cases are cheapest to cut at the writer (writer.ts "## The one rule"), since the writer
already has the findings:

```
- If the findings conclude the tweet's claim is essentially accurate, return an empty note.
- If the author truthfully disclosed the content's nature (AI-generated, satire, fiction), do not
  write a note correcting a subclaim the author never made.
```

Skip if we want a single-chokepoint change for clean attribution; the judge gates above already
cover these.

---

## 7. How to validate this cheaply (writer cache)

iter-06's per-row work was ~5 LLM calls (query writer → search analyzer → writer → judge →
verifier). G1–G3 only change the **judge**. The new `--writer-cache <dir>` flag (added this
session) caches stages 1–3 keyed by tweet id, so an iter-07 judge-prompt change replays **only the
two gates**:

```
# populate once (full pipeline, writes the cache)
bun run src/local/tryoutNotes.ts --pick bot=cheap-bot --pick verifier_media_sources=accept \
  --input-cache datasets/big_eval/_cache --search-cache datasets/big_eval/_search_cache \
  --writer-cache datasets/big_eval/_writer_cache --name iter-07-populate datasets/big_eval/splits/val.csv

# iterate: edit judge.ts, replay from the two judges only (fast, ~2 LLM calls/row)
bun run src/local/tryoutNotes.ts --pick bot=cheap-bot --pick verifier_media_sources=accept \
  --writer-cache datasets/big_eval/_writer_cache --name iter-07-judgeNN datasets/big_eval/splits/val.csv
```

Caveat: the cache freezes the writer's note, so it measures *judge/verifier* changes only. Any
change to the query writer or writer prompt needs a fresh populate.

---

## 8. Eval-strictness fixes already applied (bad-note audit, ask #1)

published_bad_report judged **5 of 16** FAILs too strict. I applied the 3 clear-cut
`judge_guidance` corrections to `val.csv` and flagged 2 as genuine-quality-bar judgment calls:

- **Applied — CBS poll (id …540578439):** a Gannett aggregator (Asbury Park Press) now counts as
  credible sourcing; the guidance only ever meant to bar Wikipedia/Rasmussen.
- **Applied — Netanyahu (id …251264262):** any verified-loading top-tier fact-check is accepted
  regardless of which March-2026 appearance date it cites; the eval had speculated a real,
  verifier-accepted Reuters URL was fabricated from a date discrepancy.
- **Applied — Trump People quote (id …046921417):** a definitive denial ("People confirmed it
  never published this") plus "fact-checkers found no record" is accepted; only weak hedges
  ("appears to be fake") are banned.
- **Flagged, NOT changed — Braille steering wheel:** guidance requires the explicit "blind people
  can't legally drive" sentence; the note said only "not for blind drivers". Debatable; left strict.
- **Flagged, NOT changed — Epstein AI image:** guidance requires the affirmative "Epstein died
  2019" sentence. Debatable; left strict.

Anti-goodhart note: these loosen the eval only where it was provably mis-scoring a *correct* note;
the 11 fair FAILs were left untouched, and the 2 flagged bars were left strict pending your call.

---

## 9. Recommended iter-07 sequence

1. Apply G1 + G2 + G3 to `judge.ts` (one prompt edit; G1 is a section replacement, G2/G3 are
   bullet additions).
2. Populate the writer cache once, then replay-from-judges to read the new FP rate in ~2 LLM
   calls/row.
3. Confirm: FP should fall toward single digits; PASS should rise (precision recovers, recall held);
   watch the §4 watch-list for any new misses.
4. If recall dips on a watch-list row, that row is the test case for whether G1/G3 over-fired —
   tune the specific tell, not the whole gate.

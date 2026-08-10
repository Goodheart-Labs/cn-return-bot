# Fixing the relevance problem: a design note

*2026-06-23, grounded in 35 live tagged not-helpful cases. Raw: [`tmp/failure_cases.md`](../tmp/failure_cases.md).*

## The finding

Our notes get rated **not-helpful for relevance, not correctness.** The top two modes — *"did not engage with the argument"* (13) and *"pedantic correction"* (13) — dwarf every technical bug (≤3 each). Every gate today asks *"is this true and cited?"*; none asks *"does correcting this change the reader's takeaway?"*

## Four sub-patterns (each needs a different fix)

- **A. Should've abstained** — joke/opinion/true tweet, note written anyway. *Trump-in-Baki nitpick; your own "napalm doesn't need a note".* → **prefilter / abstention**
- **B. Wrong target** — tweet is misleading, but we rebut a peripheral detail. *Frito-Lay "fraud" → we said "weight is disclosed" instead of "bag was resealed"; train/SUV "why stop driving" → we answered the wrong question.* → **claim-spine**
- **C. Pedantic** — correct but immaterial. *Reflecting Pool "$14.2M not $16M"; Bibb County "ages 3-15 not 3-16".* → **materiality judge**
- **D. Wrong-direction** — the "correction" *supports* the tweet. *MJ biopic "$1.11bn not ~$1bn" (i.e. more).* → **materiality judge + "does this cut against the tweet?" check**

Plus 3 **source-verifier false-accepts** (all `accepted=YES`): a hallucinated "born in the US" claim (Zul Mohamed), a 404 source, a tweet-as-source. *Your question — do we still check sources? Yes: the verifier fetches every cited source. The gap is it checks support only (no quality/recency/404 gate), and the **claim-based flow** that catches the Zul case exists as a 50/50 A/B but isn't default.*

## The build — a relevance layer (not a new bot)

Four pieces, each A/B-gated onto the current funnel:

1. **Claim-spine** (in the writer) — extract the tweet's load-bearing claim + reader takeaway; the note must target *that* or abstain. Fixes B.
2. **Stronger prefilter** — ask "is the main point misleading?" not "is any statement false?" Fixes A. (Already catches some on rerun.)
3. **Materiality judge** — new gate in `score/`, separate from verifier + eval-score: reject immaterial or wrong-direction corrections. Seed few-shot with the C/D cases. Fixes C, D.
4. **Verifier upgrades** — make claim-based flow default; add reachability/quality/recency to "accept"; give it its own model (not the writer's). Fixes the false-accepts.

**Evolve, don't rebuild.** Every piece is a gate/prompt the existing A/B config switches per-run — and you need the existing verifier/replay/A/B infra to validate it anyway. The only thing worth prototyping standalone is the claim-spine, since it changes the writer's contract.

## Validation — backrun first

1. **Eval set**: the tagged failures (negatives) **+ a sample of rated-helpful notes (controls)** — without controls a candidate "wins" by abstaining on everything.
2. **Backtest** via `replay/` + the dashboard's dataset-run path: % of negatives now abstained/fixed *and* % of controls still posted. Same test answers **"remove the X eval-filter?"** — replay on/off (don't remove blind; we only see notes that *passed* it = survivorship bias).
3. If it passes → **shadow on `staging/`** (no submit) → **low-weight A/B** → ramp.

## Caveats
- **Volume vs. helpful-rate**: all four push toward more abstention — fewer notes, against the "write more" goal. A deliberate quality bet; watch volume in the A/B.
- **Some not-helpful is rater-side** ("raters seem wrong", political modes) — won't move regardless.
- **Small N** (~35) — enough to direct, thin for strong claims.

## Open questions
1. Take the quality bet (fewer, better) — or tune to abstain *only* on the clearest C/D so volume holds?
2. Materiality judge as a hard gate, or a soft signal feeding the eval-score?
3. Is this the thing *you* build (highest-leverage, not on Jim's plate)?

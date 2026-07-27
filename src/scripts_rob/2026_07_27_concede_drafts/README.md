# Concede-then-correct sample drafts (2026-07-27)

Sample drafts for PR #320 (concede-then-correct experiment), generated locally
via the new `tryoutNotes --topic` flag (PR #321) on six posts we previously
noted — chosen so each new draft has the old note's real rating record as its
baseline. Run: `dataset_runs/tryout-concede-drafts-v2-2026-07-27-1746`
(v1 run `…-1742` predates the writer rule and chromium install; kept for the
doc-only-doesn't-steer finding).

## Method finding that reshaped PR #320

The doc-only version of the experiment does NOT change notes: the writer sees
the document in its findings, but `MISINFO_NOTE_SHAPE_RULE` in the system
prompt ("one or two blunt declarative sentences… no extra background")
suppresses the concession clause — system prompt beats reference prose. The
v1 run proved it (Mullin note came out in the old shape). PR #320 now adds
`MISINFO_CONCEDE_SHAPE_RULE`, gated on the document's opt-in marker heading.

## Old note → new draft (ratings are the old note's H/S/N from the public dump)

Tweet text omitted per convention — each URL opens the post.

### 1. Muskegon FBI files — https://x.com/i/status/2079669014331007418
Old (10/0/104, trust-us sourcing — note it ALREADY opened with a concession;
its failure was assurance-stacking "officials say / FBI closed the case" +
a Detroit News source):
> Document is real, but Michigan officials say no fraudulent registrations were processed and no ballots were cast. Trump's own declassified FBI records note it was 'not believed to have led to fraudulent votes.' The FBI closed the case finding no crime or security threat. [detroitnews]

New draft (candidate):
> The FBI records are real, but investigation found the fraudulent applications were intercepted before being processed. Michigan State Police confirmed no fraudulent ballots were cast as a result. Trump's own FBI/CISA (2020) stated such efforts did not impact election results. [fox2detroit + ic3.gov]

Concede shape ✓, and the real gain here is record-over-assurance (deep-dive
experiment 3): "intercepted before being processed" replaces "officials say",
and the source moves from Detroit News to a local Fox affiliate + .gov.
Third sentence is an "also" clause the one-claim rule should have trimmed —
flag for Nathan. This pair is also a caution: the old note shows concession
alone didn't save a note whose middle was assurances.

### 2. Mullin 250k noncitizens — https://x.com/i/status/2078995866581442956
Old (6/0/21, four source URLs):
> DHS's own release calls this figure 'potential' noncitizens from unverified database matching—not confirmed. Past GOP-run audits show such estimates shrink drastically: Texas's ~95,000 claim collapsed within days; Georgia's audit found 20 of 8.2M. Registered ≠ voted. [dhs.gov + sos.texas.gov + fox5atlanta + sos.iowa.gov]

New draft (rejected: check_failed — source-verifier said the cited pages don't
fully support it; would re-draft in prod):
> Noncitizens do turn up on voter rolls, but bulk database matches routinely shrink on audit. In 2019, Texas claimed ~95,000—most were naturalized citizens and the GOP official resigned. Georgia's 2024 GOP audit found 20 out of 8.2M. Registered ≠ voted. [sos.texas.gov + fox5atlanta]

Concede shape ✓ — essentially the doc's shape example, independently produced.

### 3. O-277 / massaged-PDB post — https://x.com/i/status/2079387550595141643
Old (7/0/277, 73% missing-key-points — our worst note; no concession opener):
> Trump's own FBI & CISA (2020) stated that cyber actors obtaining voter data "did not impact the voting process or the integrity of election results." The declassified files describe China collecting voter data for espionage and opinion analysis—not changing any votes. [ic3.gov + whitehouse.gov]

New draft (candidate):
> The declassified files do describe China acquiring roughly 220 million U.S. voter records, but Trump's own FBI & CISA (2020) stated that acquiring such data "did not impact the voting process" and was likely for espionage, not altering the vote. [ic3.gov + whitehouse.gov]

Concede shape ✓ but STILL nearest-debunk substitution — the post is about the
"massaged" PDB admission and the note answers the China-data claim. The shape
rule can't fix responsiveness; that's deep-dive experiment 1 (not in #320).

### 4. China-interference leap — https://x.com/i/status/2079477981542502434
New draft (rejected: check_failed): trigger-2 shape, concedes the documents
describe collection, corrects the leap. Good shape.

### 5. Red-mirage post — https://x.com/i/status/2078694858881908800
New draft (candidate) is a thesis-defense note sourced to Newsweek + an
archived substack — the 0-conversion class with out-group sourcing. Correctly
did NOT manufacture a concession (Claim 5's "thin" True core worked), but this
post class needs experiment 5's veto, not a better note.

### 6. O-151 Dominion/Edison — https://x.com/i/status/2078921638847127632
Failed (unfetchable_sources) — no draft this run.

## Read for Nathan's review

3 clean concede-shape drafts (1, 2, 4); the star is Muskegon. Two known
failure modes visibly persist and are out of #320's scope: nearest-debunk
substitution (needs experiment 1's responsiveness gate) and thesis-defense
notes (needs experiment 5's veto). #320 changes the shape of the notes we
write; it does not change which corrections we attempt.

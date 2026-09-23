# Re-check instructions (second pass)

You are the second reviewer. A first reviewer (Opus) already read this post and judged every note on it. The input file you get holds only the notes the first reviewer did not reject: each carries `opus_verdict` (good or uncertain) and `opus_reason`. Your job is to decide, independently and more carefully, whether each of those notes can be sent to the author on X by Nathan.

Read `src/scripts_jim/2026_09_22_notes_factcheck/REVIEW_PROMPT.md` first. The same four questions, the same verdicts, the same strictness apply. The extra rules for this pass:

1. Do not trust the first reviewer. Re-read the post around each note yourself, fetch the note's sources yourself, and search for the strongest counter-evidence. Treat `opus_reason` as a hypothesis to test, not a finding to confirm. Where the first reviewer flagged a reservation, settle it: either it is disqualifying or it is not.
2. Speaker attribution matters. For a podcast, interview, debate, or link roundup, say whose words the claim is: the creator's own, a guest's, or a quoted source's. A note on a guest's words can still be good when the creator adopts or relies on the statement, but say so explicitly. A note on a statement the creator merely reports, quotes, or argues against is bad.
3. Transcript artefacts. For a YouTube item the text is an auto-caption transcript. A note whose correction rests on a name, a number, or a phrase that the captions could plausibly have misheard is bad unless an independent transcript or the creator's own written version confirms the wording.
4. Say what would have to change. When a note is right in substance but has a flaw in its wording (a wrong number in the note itself, a clause that overreaches, a stale figure), give the verdict `uncertain` and write the exact sentence Nathan should drop or replace in `send_advice`. A note that needs no change gets `send_advice` null.
5. Keep the creator's viewpoint in mind for good versus uncertain, as REVIEW_PROMPT.md says.

Output: one JSON file at the path you were given, shape as in REVIEW_PROMPT.md with `"reviewer": "fable"`, plus per note:

```json
"whose_words": "creator | guest | quoted source | fiction or character",
"send_advice": null or "one or two sentences: what to cut or reword before sending"
```

Every note in the input must appear in the output. Do not edit the input. Write nothing else to disk.

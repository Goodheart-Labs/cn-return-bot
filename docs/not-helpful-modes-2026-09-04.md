# Not-helpful notes, last 30 days: which failure modes could a writer self-check catch?

Prompted by the Lindsay Clancy note (2095914975113969821, `timing_treatment: instruction`), which was
rated not helpful within hours. Question: if we add a "Last check" block to the writer prompt, which
modes are worth a bullet?

Data: 57 notes with `cn_status = CURRENTLY_RATED_NOT_HELPFUL` from runs in the last 30 days
(`scratchpad/not-helpful-30d.tsv`, uncommitted), plus Nathan/Jim's review-dashboard tags for the last 60 days.
Context: 208 helpful / 57 not helpful rated in the same window (78% helpful of rated).

## Tentative manual classification (one primary mode per note)

| Mode | n | Examples |
|---|---|---|
| Appears correct and on-target; suspected rater disagreement | ~20 | dolphin Ceuta, Falklands, WTC7, Epstein alive, Gaza UNICEF, Altman whistleblower |
| Post is a joke, hyperbole, rhetorical question, or opinion | ~14 | voices in head, Sweden ATM, "kiss of life's career ended", "how prime epstein was moving", tax meme, Boomers house, WNBA "refusing" |
| Pedantic / side detail while main claim stands | ~9 | Palace of Fine Arts 1914→1915, McCain Dec 2013→Feb 2014, GT7 three→four cars, Taylor Swift Nashville, Hormuz conditions |
| Two or more corrections bundled | 5 | Reijnders £51m + Trafford, Minab Tomahawk + 168, Sweden euro + no €45 note, tax + April 15, slapped video |
| Absence-of-evidence correction ("no reporting confirms", "page does not list") | 3 | TPUSA Wilson, nuclear Iran meetings, Flock camera scrap |
| Contested definition / cultural stance | 3 | "just women have periods", Egyptian = African-American, nanny "no cure for Islam" |
| Media is AI-made / unofficial, post never said real | 2 | GTA6 image, Vice City leak (dashboard tags say 19 in 60d, so larger than this sample shows) |
| Premature / breaking news | 1–2 | Clancy mistrial (Negreira "officially closed" is the same shape but the note may be right) |

Roughly 35 of 57 were classified as problems the writer might notice at draft time.
The remaining ~20 were judged to be correct and on-target, but that judgment is
unverified: the ratings alone do not establish why raters rejected them or whether
a prompt change could help.

## Dashboard tags, last 60 days (production, top 10)

| Tag | n |
|---|---|
| did not engage with the argument | 31 |
| raters didn't care it was ai generated | 19 |
| didn't convince raters | 18 |
| note gave minor/pedantic correction | 12 |
| too confident | 11 |
| error in world model | 7 |
| sources unlikely to convince | 7 |
| multiple corrections, at least one unnecessary | 7 |
| humour | 5 |
| breaking news | 4 |

"Did not engage with the argument" (31) is mostly the joke/rhetoric/opinion mode plus some
wrong-target. "Too confident" (11) overlaps absence-of-evidence.

## Limitations

The raw export and per-note classifications are not committed, so these counts
cannot be independently reproduced from this document. Dashboard tags cover a
different window and may overlap; they are not additional independent cases.

There is no control sample of helpful notes. The same modes can occur in useful
corrections, so ~35/57 is a tentative scope estimate, not an expected improvement.

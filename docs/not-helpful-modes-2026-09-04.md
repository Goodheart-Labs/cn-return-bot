# Not-helpful notes, last 30 days: which failure modes could a writer self-check catch?

Prompted by the Lindsay Clancy note (2095914975113969821, `timing_treatment: instruction`), which was
rated not helpful within hours. Question: if we add a "Last check" block to the writer prompt, which
modes are worth a bullet?

Data: 57 notes with `cn_status = CURRENTLY_RATED_NOT_HELPFUL` from runs in the last 30 days
(`scratchpad/not-helpful-30d.tsv`, uncommitted), plus Nathan/Jim's review-dashboard tags for the last 60 days.
Context: 208 helpful / 57 not helpful rated in the same window (78% helpful of rated).

## My classification of the 57 (one primary mode each)

| Mode | n | Examples |
|---|---|---|
| Engages correctly, raters disagree (political / conspiracy / fandom) | ~20 | dolphin Ceuta, Falklands, WTC7, Epstein alive, Gaza UNICEF, Altman whistleblower |
| Post is a joke, hyperbole, rhetorical question, or opinion | ~14 | voices in head, Sweden ATM, "kiss of life's career ended", "how prime epstein was moving", tax meme, Boomers house, WNBA "refusing" |
| Pedantic / side detail while main claim stands | ~9 | Palace of Fine Arts 1914→1915, McCain Dec 2013→Feb 2014, GT7 three→four cars, Taylor Swift Nashville, Hormuz conditions |
| Two or more corrections bundled | 5 | Reijnders £51m + Trafford, Minab Tomahawk + 168, Sweden euro + no €45 note, tax + April 15, slapped video |
| Absence-of-evidence correction ("no reporting confirms", "page does not list") | 3 | TPUSA Wilson, nuclear Iran meetings, Flock camera scrap |
| Contested definition / cultural stance | 3 | "just women have periods", Egyptian = African-American, nanny "no cure for Islam" |
| Media is AI-made / unofficial, post never said real | 2 | GTA6 image, Vice City leak (dashboard tags say 19 in 60d, so larger than this sample shows) |
| Premature / breaking news | 1–2 | Clancy mistrial (Negreira "officially closed" is the same shape but the note may be right) |

Roughly 35 of 57 are things the writer could plausibly notice at draft time. The other ~20 are
raters disagreeing with a correct, on-target note; no prompt fixes those (relevance-layer-design.md
says the same).

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

## What's already gated upstream

- Search prompt lists "Opinions, satire, jokes, hyperbole" under when NOT to correct; there is also a
  satire prefilter. Jokes still lead the writer-checkable leaks, so a third pass is cheap.
- Writer style says "One key fact" but 5/57 bundled two corrections anyway.
- Nothing anywhere covers: qualifier hedges, absence-of-evidence, AI-only corrections, contested
  definitions, premature posts.

## Recommendation: 7 bullets, one rule, one line of motive

```
## Last check
Draft the note, then read it as a rater would. Return empty if any of these hold:
- the post is a joke, hyperbole, a rhetorical question, or an opinion
- the post was early, or overtaken by later events, rather than wrong
- the dispute is over a definition or a framing, not a checkable fact
- the note only holds with a qualifier ("at post time", "formally", "technically")
- the note corrects a side detail while the main claim stands
- the note rests on not finding something ("no reporting confirms", "the page does not list")
- the note's only correction is that the media is AI-made or unofficial, and the post never said it was real
If you have two corrections, keep the strongest one.
A not-helpful note costs more than a missed post.
```

Ship as a 50/50 writer A/B (`writer_last_check` on/off). Guard metric: abstention rate. Outcome
metric: net helpful of labeled at 48h, per the timing-test convention.

Expected reach: ~35/57 not-helpful are in scope, but the rule will also abstain on some helpful
notes (the same modes appear among helpful notes too, e.g. joke posts that are actually
misinformation). Without a control sample of helpful notes this number is a ceiling, not a forecast.

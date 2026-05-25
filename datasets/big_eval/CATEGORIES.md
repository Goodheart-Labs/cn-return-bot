# big_eval category map (v1 — APPROVED, but living)

**Status:** v1 working taxonomy, approved for *stratifying* selection. It is NOT set in stone — it
was derived from reading ~128 notes. During annotation (Phase 6) every one of the ~500 selected
notes is read in full; the annotator records a `category_fit` judgment and a `suggested_category`
when nothing fits, and the taxonomy is then revised + re-tagged before final assembly.

Discovered by reading a 298-note diverse sample + keyword prevalence over all 104,854 corpus
notes. Categories are chosen to **map the territory that stresses the pipeline**, not generic
content topics. Two orthogonal axes + a showcase layer:

- **Axis 1 — role:** `helpful_reference` | `unhelpful_<reason>` | `no_note_needed`
- **Axis 2 — category:** the 13 territory categories below (multi-label)
- **Showcase flags:** the 3 "excellence" buckets you called out (orthogonal quality tags on helpful notes)

## Territory categories

| # | category | what it is / why it stresses the pipeline | signal | example notes |
|---|---|---|---|---|
| 1 | **ai_generated_media** | Synthetic video/image presented as real. Media analysis must flag it; the right note is often just "this is AI" — but **AI media descriptions can themselves be wrong** (a tweet may falsely *claim* something is AI, e.g. Netanyahu "6 fingers"). Biggest single category. | ~8.5% (~9k) | AI Iran strike clip; "MADE WITH AI" scorpion; AI migrant-facility |
| 2 | **misattributed_or_miscontextualized_media** | Real but **old/unrelated** footage/photo (incl. misdated historical photos) sold as a current/different event. Needs temporal/reverse-image research; comments often reveal the true source. | ~4% + much of war | Gaza 2023 clip as 2026 Iran; LA 2019 helicopters as Venezuela; Condoleezza 2004 photo |
| 3 | **manipulated_or_fabricated_evidence** | Doctored images, **fake tweet/article screenshots, fabricated quotes** ("did not say"). Detect fabrication + find the real quote/source. | ~4.6% | fabricated Trump tweet; "plans plans" duplicated-word fake; IRGC didn't say "you're fired" |
| 4 | **staged_or_scripted_content** | **Real** video but staged stunt/photoshoot/scripted, shown as spontaneous/real. Distinguish staged from real. | present | staged safety-net stunt; visible-tripod "Tucson" scene |
| 5 | **breaking_news_and_war** | Fast-moving conflict (Iran/Israel/Ukraine/Russia), strikes, casualties, captures. **Risky present-tense claims**, fog of war → high not-helpful risk. | ~8.6% | tanker seizure; F-35 shootdown claims; casualty figures |
| 6 | **statistical_or_numerical_claim** | Wrong figures, **per-capita** errors, financial math. Precise verification + per-capita reasoning. | ~5.3% | PA-vs-Canada MRI per-capita; Dresden vs Holocaust numbers; bitcoin math |
| 7 | **conspiracy_and_viral_hoax** | Epstein/Pizzagate, **death hoaxes** (Netanyahu ×many), alien-comet, debunked viral stories. Known debunks; recurring; needs dedupe. | common | Skippy/Pizzagate; "Netanyahu dead"; 3I/ATLAS aliens |
| 8 | **politics_and_policy** | What a **bill/vote/official** actually did; partisan misreads. Precise legislative facts + bridging tone. | ~4.7% | H.Res.1128 non-binding; Massie vote rationale; DHS funding numbers |
| 9 | **health_medical_science** | Vaccines, disease, research, **science explainers**. Authoritative sourcing, nuance, no overclaiming. | ~2.5% | measles complications; snow-burning science; Tourette's |
| 10 | **overhyped_research_or_product** | Exaggerated findings / product / AI hype ("cure", "finally here"). **Nuanced "real but overstated" in 280 chars.** | ~0.8% (rare) | colon-cancer "cure" (mice only); orbital-reflector demo app |
| 11 | **scams_fraud_finance** | Fake giveaways, crypto, phishing, get-rich math. Identify scam patterns. | ~2.2% | fake team_orl giveaway; IBIT ETF flows |
| 12 | **platform_manipulation** | **The note is about account behavior, not a claim**: engagement farming, stolen content, bot/AI-image-farm accounts, undisclosed ads. A distinct mode. | present | "copy the link → Tesla" farm; stolen tweet; undisclosed ad; AI-image-farm sob story |
| 13 | **celebrity_entertainment_sports** | Pop-culture drama, allegations, results, misattributed clips. Often lower-stakes / note-not-needed. | common | John Cena "backlash"; UFC title; Arsenal shots-on-target |

## Showcase flags (your 3 "excellence" buckets — best-effort; genuinely rare in the data)

- **impact_values_aligned** — high-importance misinfo via an EA / progress / AGI-safety / animal-welfare
  lens (AI labs & policy, biosecurity, animal agriculture, major legislation). *Rare* (AI-industry ~1%,
  animal-welfare ~0.1%). e.g. "OpenAI does not own all ChatGPT output."
- **impressive_concise_debunk** — does something hard well inside 280 chars (overhype debunk, subtle
  numeric/scientific nuance). e.g. cluster-munitions "neither is a signatory"; per-capita MRI.
- **bridging_cross_partisan** — corrects a politically-coded claim yet rated helpful across groups, or
  points to a compromise / "both sides do this." e.g. "busing protesters is done by both parties";
  "Massie opposed the bill over CISA, not ICE."

## Second axis discovered during annotation: `no_note_reason` (the false-positive flavor)

Annotating the first batch revealed that **many notes tagged `notHelpfulIncorrect` are actually false
positives on TRUE tweets** — the *note* is the misinfo, not the tweet (e.g. a note "correcting" a real
event that did happen). The territory categories don't capture *why* no note is needed, which is
exactly what the pipeline must learn. So `needs_note="no"` rows now carry a `no_note_reason`:

- `true_claim` — tweet verified true; note denies/contradicts a real fact
- `opinion_or_framing` — only subjective characterization, nothing checkable
- `accurate_reporting_contested` — tweet accurately quotes credible reporting; note injects a contested counter-narrative
- `joke_or_meme`, `satire_parody`
- `trivial_pedantry` — technically-true nitpick
- `obvious_fake_widely_known`
- `insider_reporting_framing` — dispute is over a framing word, not a fact

This is orthogonal to the 13 territory categories and is the highest-value signal for false-positive
suppression. Final counts per `no_note_reason` will be reported in report.md after annotation.

## Proposed selection budget (~500 total, ~50% needs_note=no) — please adjust

| bucket | ~count | needs_note |
|---|---:|---|
| **No-note half** (note-not-needed signal + curated satire/opinion/pedantic), spread across categories 1–13 | **~250** | no |
| Failure: notHelpfulIncorrect | 40 | yes |
| Failure: notHelpfulMissingKeyPoints | 40 | yes |
| Failure: notHelpfulOpinionSpeculation | 30 | yes |
| Failure: notHelpfulSources(Missing/Unreliable/Irrelevant) | 30 | yes |
| Failure: notHelpfulHardToUnderstand (thin — sourced as secondary tag too) | 15 | yes |
| Helpful diversity across categories 1–13 | 55 | yes |
| Showcase: impact_values_aligned | 15 | yes |
| Showcase: impressive_concise_debunk | 10 | yes |
| Showcase: bridging_cross_partisan | 10 | yes |
| **Total** | **~495** | ~50/50 |

## Data realities that shaped this (FYI)

- **Many "unhelpful" notes are actually correct** but failed on sourcing/tone/timing. For failure rows
  I'll fact-check and decide: a *better* note is warranted (needs_note=yes, ground truth = the fix) vs
  it was a note-not-needed case (needs_note=no).
- **Recurring viral events dominate** (Netanyahu death-hoax, Iran–Israel war, Epstein, Maduro capture,
  Alex Pretti). Selection caps per event/cluster so the set isn't 30 near-duplicates.
- **No-note half is abundant**: 23,213 NMR + 780 NOT_HELPFUL notes carry note-not-needed ratings; the
  juiciest are pedantic corrections on obvious jokes/fakes/parody (a real notewriter was tempted and
  shouldn't have written) — ideal false-positive traps.
- **Excellence is rare** (as you predicted): showcase counts are best-effort ceilings, not quotas.

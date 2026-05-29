# big_eval dataset report
Total assembled rows: **652** (test=100, val=100, pool=452).

## needs_note balance
- **yes**: 310 (47.5%)
- **no**: 342 (52.5%)

## Role distribution
- `no_note_needed`: 330
- `helpful_reference`: 125
- `unhelpful_missing_key_points`: 83
- `unhelpful_incorrect`: 33
- `unhelpful_opinion_speculation`: 22
- `unhelpful_sources_missing_or_unreliable`: 22
- `unhelpful_note_not_needed`: 20
- `unhelpful_irrelevant_sources`: 6
- `unhelpful_hard_to_understand`: 5
- `unhelpful_other`: 3
- `unhelpful_argumentative_or_biased`: 3

## no_note_reason distribution (rows where needs_note=no)
- `opinion_or_framing`: 82
- `joke_or_meme`: 70
- `true_claim`: 59
- `accurate_reporting_contested`: 45
- `trivial_pedantry`: 42
- `satire_parody`: 21
- `obvious_fake_widely_known`: 9
- `insider_reporting_framing`: 9
- `(unset)`: 5

## Category coverage (multi-label, counts rows where category appears)
- `misattributed_or_miscontextualized_media`: 189
- `politics_and_policy`: 158
- `breaking_news_and_war`: 156
- `celebrity_entertainment_sports`: 150
- `conspiracy_and_viral_hoax`: 91
- `ai_generated_media`: 75
- `statistical_or_numerical_claim`: 68
- `joke_or_satire`: 64
- `manipulated_or_fabricated_evidence`: 54
- `health_medical_science`: 44
- `staged_or_scripted_content`: 28
- `scams_fraud_finance`: 25
- `overhyped_research_or_product`: 18
- `platform_manipulation`: 18
- `legal_or_court_claim`: 10
- `fabricated_quote`: 10
- `antisemitic_conspiracy`: 3
- `real_media_falsely_called_ai`: 1

## Category × needs_note matrix

| category | yes | no | total |
|---|---:|---:|---:|
| misattributed_or_miscontextualized_media | 134 | 55 | 189 |
| politics_and_policy | 78 | 80 | 158 |
| breaking_news_and_war | 95 | 61 | 156 |
| celebrity_entertainment_sports | 34 | 116 | 150 |
| conspiracy_and_viral_hoax | 77 | 14 | 91 |
| ai_generated_media | 53 | 22 | 75 |
| statistical_or_numerical_claim | 45 | 23 | 68 |
| joke_or_satire | 3 | 61 | 64 |
| manipulated_or_fabricated_evidence | 42 | 12 | 54 |
| health_medical_science | 27 | 17 | 44 |
| staged_or_scripted_content | 10 | 18 | 28 |
| scams_fraud_finance | 10 | 15 | 25 |
| overhyped_research_or_product | 9 | 9 | 18 |
| platform_manipulation | 6 | 12 | 18 |
| legal_or_court_claim | 4 | 6 | 10 |
| fabricated_quote | 6 | 4 | 10 |
| antisemitic_conspiracy | 3 | 0 | 3 |
| real_media_falsely_called_ai | 1 | 0 | 1 |

## Disagreements with provisional label
- 218 of 652 rows (33%) flipped from the provisional role during annotation.

## Splits — needs_note balance

| split | yes | no | total |
|---|---:|---:|---:|
| test | 50 | 50 | 100 |
| val | 50 | 50 | 100 |
| pool | 210 | 242 | 452 |

## suggested_category — top 30 (taxonomy v3 input)

- `fabricated_quote`: 6
- `ai_generated_or_manipulated_media`: 3
- `joke_or_satire`: 3
- `satire_or_joke_misread`: 3
- `personal_anecdote`: 2
- `accurate_reporting_of_ai_image`: 2
- `science_curiosity_post`: 2
- `personal_anecdote_engagement_bait`: 2
- `anecdotal_personal_story`: 2
- `satire_parody`: 2
- `antisemitic_conspiracy`: 2
- `ai_generated_media`: 2
- `court_case_legal_claim`: 2
- `cgi_simulation_clearly_illustrative`: 1
- `misquoted_per_year_vs_total`: 1
- `news_headline_amplification`: 1
- `physics_demo_correct`: 1
- `wholesome_animal_content`: 1
- `hyperbolic_enthusiasm`: 1
- `user_call_to_action_opinion`: 1
- `fabricated_announcement`: 1
- `viral_dashcam_clip`: 1
- `misrepresented_platform_policy`: 1
- `shitpost_quote_in_quotes`: 1
- `incident_framing_mischaracterized`: 1
- `viral_lifestyle_trend`: 1
- `explainer_animation`: 1
- `sanctions_crypto_enforcement`: 1
- `opinion_framing_no_correctable_claim`: 1
- `false_factual_trivia_claim`: 1

## Difficulty distribution
- medium: 297
- easy: 248
- hard: 107

## Importance / prominence
- medium: 240
- high: 209
- low: 203

## Example test rows (5 yes + 5 no)

### `2022540911629222110` — needs_note=yes, role=helpful_reference
- Categories: politics_and_policy, breaking_news_and_war, misattributed_or_miscontextualized_media
- Tweet: Wasn't Charlie Kirk just canvassing a Dem area when a Dem shot him? https://t.co/7AhGLL0mxv https://t.co/C4Smaz89oy
- judge_guidance: PASS if the note establishes BOTH: (1) Kirk was shot at Utah Valley University in Utah County, a strongly Republican area (Trump won ~68% in 2024), NOT a 'Dem area' — and (2) the shooter Tyler Robinson was registered to vote as unaffiliated/no-party, not as a Democrat. Citing CNN/NBC/ABC on the susp…

### `2056862634209874000` — needs_note=yes, role=helpful_reference
- Categories: conspiracy_and_viral_hoax
- Tweet: 🚨 BREAKING: BIDEN BODY DOUBLE AJ BARRON JUST FLIPPED AND IS TURNING STATE’S EVIDENCE — EVERY SINGLE AUTOPEN PARDON AND ORDER WAS SIGNED BY A FUCKING ACTOR, NOT THE PRESIDENT, AND THE ENTIRE DEEP STATE COUP IS ABOUT TO GET BLOWN WIDE OPEN!  …
- judge_guidance: PASS only if the note establishes that the claim is false/fabricated and originates from a satire source (America's Last Line of Defense), with no credible evidence of any 'AJ Barron' Biden body double turning state's evidence. The note must NOT entertain the body-double/autopen-actor conspiracy as …

### `2032110843635089792` — needs_note=yes, role=unhelpful_opinion_speculation
- Categories: breaking_news_and_war, conspiracy_and_viral_hoax
- Tweet: #BREAKING: Iranian supreme leader confirmed in a coma, and had his leg amputated.
- judge_guidance: PASS only if the note states that the coma-and-amputation claim is UNVERIFIED / not confirmed (traceable to anonymous tabloid sources), and ideally notes that Iran acknowledged he was injured and issued a statement in his name via state media. The note must NOT itself over-claim the opposite as sett…

### `2034603293112930531` — needs_note=yes, role=helpful_reference
- Categories: breaking_news_and_war, misattributed_or_miscontextualized_media
- Tweet: 🚨HOLY FCK!! WORLD WAR 3?   The Arab countries have officially threatened to join the United States and Israel in the war against Iran. 👀 https://t.co/TnYrKKYHVb
- judge_guidance: PASS only if the note corrects the specific overstatement: there is no official Arab/GCC statement threatening to JOIN the US-Israel offensive against Iran; Gulf leaders affirmed they are not participating and are prioritizing defense, diplomacy, and de-escalation (a reserved right to self-defense i…

### `2057419233357660391` — needs_note=yes, role=helpful_reference
- Categories: politics_and_policy, statistical_or_numerical_claim
- Tweet: Ed Callrein got 57,822 mail-in ballots.   Thomas Massie received 47,538.  Callrein was unknown and Massie was dog walking him in the polls (up to 70% in many cases) up until DAYS before the election.   There weren’t 100k+ mail in ballots tu…
- judge_guidance: PASS only if the note (a) explicitly states that 57,822 and 47,538 are TOTAL votes, not mail-in/absentee ballots, and (b) gives the actual absentee figures (~10,854 for Gallrein, ~8,421 for Massie) or otherwise cites the KY Secretary of State official results. A correct note must cite vrsws.sos.ky.g…

### `2012505667932754385` — needs_note=no, role=no_note_needed
- Categories: breaking_news_and_war, misattributed_or_miscontextualized_media
- no_note_reason: `opinion_or_framing`
- Tweet: This is why you don’t stop. https://t.co/D9dEVtQHFz
- judge_guidance: PASS only if the bot DECLINES to write a note. This is a false-positive trap: the video is the genuine, correctly-contextualized Jan 11, 2026 Westwood/Los Angeles anti-Iran-regime rally truck-ramming, and the post adds only inflammatory opinion ('this is why you don't stop') with no false factual cl…

### `1989040065407004945` — needs_note=no, role=no_note_needed
- Categories: conspiracy_and_viral_hoax, fabricated_quote
- no_note_reason: `joke_or_meme`
- Tweet: Jeffrey Epstein asked his brother, Mark Epstein, whether Putin has photos of Trump blowing “Bubba,” which is Bill Clinton’s nickname. https://t.co/Ts4Uvq3RaU
- judge_guidance: PASS only if the bot declines to write a note OR writes a note that BOTH (a) corrects the sender/recipient reversal (MARK wrote to Jeffrey, not the other way around) AND (b) explicitly notes that Mark Epstein has publicly stated 'Bubba' was NOT a reference to Bill Clinton. FAIL if the note repeats t…

### `2012810884482265285` — needs_note=no, role=no_note_needed
- Categories: breaking_news_and_war, health_medical_science
- no_note_reason: `accurate_reporting_contested`
- Tweet: There is growing evidence that the brutal Iranian regime has used chemical agents against protesters. Last week, videos surfaced showing repression forces in Sabzevar, Razavi Khorasan Province, wearing protective clothing and masks typicall…
- judge_guidance: PASS only if the bot DECLINES to write a note (or, at most, writes a carefully hedged note noting the chemical-use allegation is reported but not independently lab-confirmed). This is a contested-reporting trap. The tweet hedges ('growing evidence') and aligns with credible outlets (Iran Internation…

### `2024124241604464864` — needs_note=no, role=no_note_needed
- Categories: ai_generated_media
- no_note_reason: `obvious_fake_widely_known`
- Tweet: Michael Jackson in his free state.   No makeup, no mask, no worries. 🖤 https://t.co/b2yG2raIp3
- judge_guidance: PASS only if the bot declines to write a note. The image is a recognized AI/edited fan tribute, and the audience already knows it (replies are saturated with 'this is AI'); it illustrates a TRUE fact (MJ had vitiligo, per his autopsy), so there is no harmful false claim to correct. A note is a false…

### `2005092977849594309` — needs_note=no, role=no_note_needed
- Categories: overhyped_research_or_product, celebrity_entertainment_sports
- no_note_reason: `opinion_or_framing`
- Tweet: I just got the iPhone 17 Pro.  Was listening to music while at the gym and after an hour it was still at 100%.  The battery is insane.
- judge_guidance: PASS only if the bot declines to write a note. The tweet is an anecdote/opinion about subjective phone performance — not a misleading factual claim warranting correction. Any note explaining iPhone battery-percentage rounding behavior is a false positive on opinion content. The bot must avoid the or…


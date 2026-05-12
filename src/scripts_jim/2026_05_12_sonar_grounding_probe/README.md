# 2026-05-12 — Sonar grounding probe

## Background

A 2026-05-10 production run of `sonar-reasoning-pro` recommended
submitting a community note that contradicted reality. The post said
Charlie Kirk was dead (true since 2025-09-10). Sonar's findings
concluded `correction_needed: true` based on misreading the in-prompt
video transcript ("'Charlie was learning…' → he must be alive"). My
prior PR #130 had probed sonar configs and concluded "✓ works fine" —
but I'd only checked whether the JSON parsed, not whether the search
step actually grounded the answer.

## Probes

| File | Question |
|---|---|
| `01_probe_sonar_grounding.ts` | Does sonar actually search the web under different `response_format` configs, given a question that *only* fresh web data can answer? |
| `02_probe_prod_shape.ts` | Same question, but with the *exact* production prompt shape (full tweet + video transcript + comments). Does the in-prompt video transcript suppress grounding? |

## Findings

### Probe 01 (short prompt, explicit "is Kirk dead?" question)
**Every config correctly identified Kirk as dead**, including the current production config (`response_format=json_schema`). My PR #130 diagnosis was wrong: the search step *was* running; I'd just been looking for citations in the wrong place (OpenRouter doesn't surface Perplexity's `citations` field — URLs end up inlined in the `content` text).

| model | A (prod) | D (prompted JSON) | E (control) |
|---|---|---|---|
| sonar-pro | ✓ death, 5 URLs | ✓ death, 5 URLs | ✓ death, 3 URLs |
| sonar-reasoning-pro | ✓ death, 2 URLs | ✓ death, 4 URLs | ✓ death, 2 URLs |

Cost ~$0.01–0.015 across all configs, consistent with the search step running.

### Probe 02 (full production prompt shape)
When the prompt includes the video transcript with Erika Kirk's anecdote about Charlie completing Hillsdale courses, **the model anchors on that in-prompt context and stops looking** — exactly what happened in production.

| model | A (prod) | D (prompted JSON) | A+hardened | D+hardened |
|---|---|---|---|---|
| sonar-pro | **✗ missed death** | **✗ missed death** | ✓ death | **✗ + falsely correction_needed=true** |
| sonar-reasoning-pro | ✓ death | ✓ death | ✓ death | ✓ death |

- **Sonar-pro is the weaker link** — fails 3/4 configs on this prompt shape.
- **Sonar-reasoning-pro is more robust** here (caught death in every config), though the actual prod run that prompted this investigation *did* miss it, so it's not 100%. Sonar-reasoning-pro had a 1/36 (~3%) `model_output_invalid` rate over 14 days per PR #130's investigation; this kind of anchoring miss is what shows up at the same prevalence.
- **The "hardened" system prompt** (added instruction: "verify time-sensitive facts via search even when the post provides context") helps sonar-pro half the time, doesn't move sonar-reasoning-pro (already catching everything).
- **URLs in findings: ~0–1 per response.** Config D does NOT increase URL citations — the dense prompt eats the output token budget on analysis text.

### Updated diagnosis (correction to PR #130)

| Hypothesis (PR #130) | Now (this probe) |
|---|---|
| Sonar's grounding gets disabled by `response_format: json_schema` | **Wrong.** Grounding runs under every config. |
| `cite=0` in PR #130's probe ⇒ no search | **Wrong.** OpenRouter doesn't surface Perplexity's `citations` field — URLs are in the `content` text. PR #130's column-name was the bug. |
| The fix is dropping `response_format` for sonar | **Not the fix.** Switching to prompted JSON doesn't improve grounding or URL count. |

The actual cause is **prompt anchoring**: when we include the video
transcript in the search-step prompt, sonar uses it as evidence
rather than searching for external evidence. Sonar-pro is especially
susceptible.

## The fix that landed (this PR)

Probes 03 + 04 + 05 found the actual escape hatch: **Perplexity's
grounded citations are reliably exposed via `message.annotations[*].url_citation.url`**
under every config (with or without `response_format`). PR #130's
"cite=0" was looking at the wrong field (`response.citations` doesn't
exist over OpenRouter; `message.annotations` is where they live).

The pipeline change: in `searchWithSonarBundled`, detect whether the
parsed `findings` already contains a URL (via `linkify-it`); if not,
append a `# Citations\n<url>\n<url>...` footer built from
`message.annotations`. The downstream note-writer + verifier now
always has grounded URLs to work with, even on runs where sonar
forgot to inline citations into its findings text.

## What this PR does NOT fix

The intermittent anchoring failure where sonar reads an in-prompt
video transcript and confidently concludes `correction_needed: true`
on factually-correct posts is **still possible**. The Charlie Kirk
prod failure was an instance of this. Mitigations (separate work):

- Strip the video transcript / comments from the *search* prompt.
- Make the verifier more skeptical when correction_needed=true comes
  from a search step whose findings don't cite specific facts about
  the contested claim.

## What's NOT a fix (per earlier wrong diagnoses)

- Switching `response_format` configs (PR #130's earlier conclusion
  was wrong — annotations are populated under either config).
- Adding a balanced-brace fallback in `parseSearchJson`.
- Per-provider response shape inspection.

# In-group sourcing (PR #283) — code walkthrough

The PR makes the misinfo writer cite **in-group / primary sources** instead of out-group outlets (CNN/NBC/PolitiFact/ABC) that the post's audience distrusts. Below are the actual changes. Under each is a **Q for you** — answer in your own words right under the `⟢ Q` (plain text). Goal: you understand every change before we merge, and we surface anything worth tweaking.

---

## The problem (one line)

Trump notes cited out-group outlets → can't bridge to "Helpful" → not-helpful notes drag our writing reputation → **lower the cap for every topic.** Root cause: the topic's reference doc (full of good in-group sources) was injected only into the **search** step, never the **writer** — and the writer cites only URLs that appear in its findings, so it *couldn't* cite them.

---

## Block 1 — the sourcing rule (`prompts/simple-bot/writer.ts`)

```ts
export const MISINFO_SOURCING_RULE = `

## Sourcing for this curated topic
The findings begin with a reference document listing vetted in-group / primary
sources for this topic. Judge each post on its own — but posts on this topic often
come from an audience that distrusts mainstream outlets, and a note they won't rate
"Helpful" changes no minds and hurts our standing. In those cases, prefer the
reference document's in-group / primary sources (official .gov records, the
subject's own government and agencies, state officials, outlets like Fox News,
National Review, The Daily Signal, Deseret News) and cite CNN, NBC, PolitiFact,
ABC and similar mainstream outlets *less*. Still only cite URLs that actually
appear in the findings; never invent any.`;
```

> ⟢ **Q1** (Claude) — This is a **soft preference** ("prefer… cite *less*"), not a hard block that rejects any note citing CNN. What failure mode are we deliberately *accepting* by keeping it soft — and why did we choose that over a hard block?

---

## Block 2 — inject the reference doc into the writer's findings (`simple-bot/writer.ts`)

```ts
const monitoring = getMonitoringContext();
let systemPrompt = config.writer_examples ? basePrompt + WRITER_FEWSHOT_EXAMPLES : basePrompt;

let effectiveFindings = findings;
if (monitoring) {
  systemPrompt += MISINFO_SOURCING_RULE;
  effectiveFindings = `${buildReferenceBlock(monitoring)}\n\n${findings}`;   // ← the doc goes IN the findings
  log?.set("writer.misinfoSourcing", true);
}
```

> ⟢ **Q2** (Claude) — Why do we **prepend the whole reference document to the findings** (`effectiveFindings`), instead of just adding the sourcing *rule* to the prompt? (Hint: re-read the writer's hard constraint — "cite only URLs that appear in the findings.")

---

## Block 3 — the guard

The entire change sits behind `if (monitoring)` — `getMonitoringContext()` returns something only for misinfo-monitoring topics (Trump, AI-water, etc.), and `undefined` for everything else.

> ⟢ **Q3** (Claude) — What happens to a **normal, non-misinfo note** (the ~19/day regular flow) under this PR — and why is that guard the thing that lets us ship a sourcing change without risking the rest of the pipeline?

---

## Open questions / risks (mark these too)

- **R1 — will it actually obey?** It's a soft rule + an LLM. The writer *might* still reach for a mainstream URL if that's what the search surfaced and the in-group one is weaker.
  > ⟢ **Q4** (Claude) — Given it's soft, **how will we know if it worked** — what's the concrete signal, and where do we look for it? (We built the thing that shows it.)
- **R2 — token cost.** We now inject the full ~170-line reference doc into the writer on every misinfo note (it was already going into the search step). Cheap in dollars (≤10 notes/run), but worth naming.
  > ⟢ **Q5** (Claude) — Do you want the *full* doc in the writer, or just its **source list + gold-standard examples** (trimming the prose)? Full is simplest and gives the writer the example notes too; trimming saves tokens. I lean full for v1 — agree?
- **R3 — it's Jim's grounding-doc territory.** The rule leans on the doc he authored. Merging as-is is fine (soft, reversible), but he may want to word the rule differently.
  > ⟢ **Q6** (Claude) — Merge now and let Jim refine later, or hold #283 for a quick Jim look at the rule wording first?

/**
 * Misinformation topics for the XXL-feed pre-pass.
 *
 * Each topic carries:
 *  - a keyword predicate (regex, ported verbatim from the investigation's
 *    findClaims.py, INCLUDING the `\bai\b` word-boundary fix — un-bounded `ai`
 *    matched "rain"/"maintain" and inflated the AI-water hits from ~31 to 84),
 *  - `document`: the full undistilled article, injected into the bot's research
 *    step for grounding (read from documents/<id>.md at import),
 *  - `brief`: a distilled debunking brief, fed only to the selection LLM that
 *    decides which matched posts actually need a note (read from briefs/<id>.md).
 *
 * Predicates run against the lowercased blob() from keywordFilter.ts, so the
 * regexes are authored in lowercase and need no `i` flag.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MisinfoTopicId } from "./topicIds";

export interface MisinfoTopic {
  id: MisinfoTopicId;
  title: string;
  documentUrl: string;
  matches: (blob: string) => boolean;
  document: string;
  brief: string;
}

const HERE = import.meta.dir;
const read = (folder: string, id: string): string =>
  readFileSync(join(HERE, folder, `${id}.md`), "utf8");

// Shared sub-patterns (ported from findClaims.py).
const AI =
  /(\bai\b|\ba\.i\.?|chatgpt|chat gpt|openai|\bllm\b|artificial intelligence|\bgpt\b|gemini|\bgrok\b|chatbot|data ?cent(er|re))/;
const ENERGY =
  /(energy|electricit|\bkwh\b|\bwatt|carbon|emission|\bco2\b|climate|power grid|fossil|environment|footprint|greenhouse)/;
// Three clauses: a fraud/tampering FRAME + an election OBJECT + a 2020/national
// ANCHOR. The frame+object pair alone matched the whole US election-fraud
// firehose (incl. live local races the grounding doc can't address — e.g. the
// 2026 California contests); the anchor narrows to the specific "2020 (/22/24)
// stolen / China / hacked-machines / noncitizen-rolls / declassified-docs"
// cluster the document actually debunks. Empirically (19.6k post-speech feed):
// frame+object = 530 hits, + anchor = 391. The selection LLM + brief still do
// the claim-vs-debunk precision; the anchor only does topic scoping.
const ELECTION_FRAUD_FRAME =
  /(rigged|rig the|stolen|\bstole\b|\bsteal\b|fraud|fraudulent|flip(ped|ping)?|hacked|manipulat|tamper(ed|ing)?|decertif|overturn(ed|ing)?|ballot stuffing|dead voters|noncitizen|non-?citizen|illegal (vote|ballot|voter)|cheat(ed|ing)?)/;
const ELECTION_OBJECT =
  /(election|\bvote[sd]?\b|\bvoting\b|ballot|voter (roll|file|registration|data)|voting machine|dominion|smartmatic|raffensperger|recount)/;
const ELECTION_2020_ANCHOR =
  /(\b20(16|20|22|24)\b|dominion|smartmatic|raffensperger|voting machines?|voter files?|voter rolls?|non-?citizens?|declassif|220 ?million|deep state|decertif|overturn|stolen election|election was stolen|rigged election|chin(a|ese)|foreign (interference|meddl|power)|mail-?in ballot)/;

interface TopicSpec {
  id: MisinfoTopicId;
  title: string;
  documentUrl: string;
  matches: (t: string) => boolean;
}

const SPECS: TopicSpec[] = [
  {
    id: "ai_water",
    title: "AI water use",
    documentUrl: "https://blog.andymasley.com/p/the-ai-water-issue-is-fake",
    matches: (t) => /\bwater\b/.test(t) && AI.test(t),
  },
  {
    id: "datacenter_land",
    title: "Data center land use",
    documentUrl: "https://blog.andymasley.com/p/data-center-land-use-issues-are-fake",
    matches: (t) =>
      /data ?cent(er|re)/.test(t) &&
      /(farmland|farm land|\bfarms?\b|\bacres?\b|agricultur|cropland|\bland use\b|\bfarmer)/.test(t),
  },
  {
    // Distinct from ai_energy_carbon (per-use): this is the "training a model
    // emitted catastrophic CO2" myth (the viral 626,000-lb chart). The \btrain\b
    // requirement is the discriminator; listed before ai_energy_carbon so a post
    // matching both is processed under this topic (first-sighted wins dedup).
    id: "ai_training_emissions",
    title: "AI model training emissions",
    documentUrl: "https://blog.andymasley.com/p/training-ai-models-doesnt-emit-that",
    matches: (t) => /\btrain(ing|ed)?\b/.test(t) && AI.test(t) && ENERGY.test(t),
  },
  {
    id: "ai_energy_carbon",
    title: "AI energy and carbon footprint",
    documentUrl: "https://blog.andymasley.com/p/a-cheat-sheet-for-conversations-about",
    matches: (t) =>
      /(chatgpt|chat gpt|openai|\bllm\b|chatbot|\bprompt|\bquer)/.test(t) && ENERGY.test(t),
  },
  {
    id: "openai_dod",
    title: "OpenAI's Department of Defense deal",
    documentUrl:
      "https://www.techpolicy.press/five-unresolved-issues-in-openais-deal-with-the-department-of-defense/",
    matches: (t) =>
      /(openai|chatgpt|sam altman|anthropic|\bai\b)/.test(t) &&
      /(pentagon|department of defense|\bdod\b|defense department|\bmilitary\b|warfight|surveillance|autonomous weapon|lawful use)/.test(
        t,
      ),
  },
  {
    id: "save_our_bacon",
    title: "Save Our Bacon Act / farm animal welfare",
    documentUrl:
      "https://forum.effectivealtruism.org/posts/vsYphZaBcXpmtNizp/time-sensitive-stop-one-of-biggest-threats-for-animal",
    matches: (t) =>
      /(save our bacon|\bsob act\b|prop(osition)? ?12|question 3|gestation crate|veal crate|(farm bill).{0,40}(animal|pork|\bpig|\bhog))/.test(
        t,
      ),
  },
  {
    // The "EA / effective altruism has accomplished nothing" dismissal. First
    // clause anchors on EA terms (deliberately NOT bare "ea" — collides with the
    // game studio); second clause is a negative-framing gate. The selection LLM
    // is the precision step that excludes fair critique of specific EA failures.
    id: "ea_achievements",
    title: "Effective Altruism's achievements",
    documentUrl: "https://willmacaskill.substack.com/p/300000-lives-100-million-hens-and",
    matches: (t) =>
      /(effective altruism|effective altruists?|givewell|macaskill|open philanthropy|80,?000 ?hours)/.test(t) &&
      /(nothing|useless|pointless|\bwaste\b|scam|grift|fraud|\bfail(ed|ure|s)?\b|hasn'?t|haven'?t|discredit|overrated|never (done|helped|achieved|accomplished)|what (has|have))/.test(
        t,
      ),
  },
  {
    // The "2020 (or 2022/2024) election was stolen/rigged/flipped" narrative,
    // revived by Trump's 16 Jul 2026 declassified-documents address. The topic
    // corrects the narrow FACTUAL claim that an outcome was changed — not
    // opinions or election-security policy views (the brief draws that line).
    id: "trump_election_fraud",
    title: "Trump's 2020 stolen-election claims",
    documentUrl:
      "https://www.cbsnews.com/news/trump-election-primetime-speech-declassified-documents-revisits-disputed-claims/",
    matches: (t) =>
      ELECTION_FRAUD_FRAME.test(t) && ELECTION_OBJECT.test(t) && ELECTION_2020_ANCHOR.test(t),
  },
];

export const MISINFO_TOPICS: MisinfoTopic[] = SPECS.map((spec) => ({
  id: spec.id,
  title: spec.title,
  documentUrl: spec.documentUrl,
  matches: spec.matches,
  document: read("documents", spec.id),
  brief: read("briefs", spec.id),
}));

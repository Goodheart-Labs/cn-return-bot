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
];

export const MISINFO_TOPICS: MisinfoTopic[] = SPECS.map((spec) => ({
  id: spec.id,
  title: spec.title,
  documentUrl: spec.documentUrl,
  matches: spec.matches,
  document: read("documents", spec.id),
  brief: read("briefs", spec.id),
}));

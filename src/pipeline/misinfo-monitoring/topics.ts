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
  /** Canonical public URL of the reference article, when the document is a copy
   *  of one. Omit for hand-authored documents that carry their own per-claim
   *  sources (e.g. trump_election_security) — the note-writer then cites from
   *  within the document instead of one blanket URL. */
  documentUrl?: string;
  matches: (blob: string) => boolean;
  document: string;
  /** The reference the selection LLM matches posts against: a distilled debunk
   *  for evergreen topics, or — for a time-boxed news event like
   *  trump_election_security — the source's transcript itself. */
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

// ── trump_election_security sub-patterns ────────────────────────────────────
// Split out of the inline predicate so each half can be read and changed on
// its own. All three are applied to the lowercased blob (see keywordFilter).

/** Does the post talk about voting at all? The context gate for ELECTION_SIGNAL. */
const ELECTION_TERM =
  /\b(elections?|elected|voters?|voting|votes?|voted|ballots?|registrations?|registered to vote|polling|poll watchers?|swing states?)\b/;

/** Claims that read as election-integrity claims once ELECTION_TERM is present.
 *  Every entry is a CLAIM marker, not merely a topic marker — "2020 election"
 *  on its own is most of the feed's political commentary, so it is admitted
 *  only in the false-victory form ("won the 2020 election"). */
const ELECTION_SIGNAL =
  /(rigged|stolen|\bstole\b|\bsteal\b|fraud|cheat|hacked|compromised|non-? ?citizens?|illegals? (are|can|can'?t|cannot|vot|regist)|illegal (aliens?|immigrants?|voters?) [a-z ]{0,20}(vot|regist)|illegal (vote|ballot)|dominion|smartmatic|maduro|venezuela|decertif|declassif|deep state|mail-?in|voter (roll|file|data|id)|voting machine|tabulator|dead voters?|duplicate registration|proof of citizenship|birth certificate|driver'?s licen[sc]e|election (security|integrity|monitors?|observers?)|monitoring elections|polling (site|place)|220 ?million|(won|winning) the 20(20|24) election|\b2[5-8]\d,?\d{3}\b|\b2[5-8]\d ?thousand\b|quarter[- ](of a )?million)/;

/** Specific enough to need no election term — these phrases have one subject. */
const ELECTION_STANDALONE =
  /(save america act|\bsave act\b|dominion voting|smartmatic|220 ?million|278,?000)/;

/** The speech's China-acquired-voter-files claim; paired with ELECTION_TERM
 *  because these words alone are nowhere near specific enough. */
const ELECTION_CHINA = /(china|chinese|\bccp\b|people's republic)/;

interface TopicSpec {
  id: MisinfoTopicId;
  title: string;
  documentUrl?: string;
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
    // Trump's July 2026 primetime election-security speech (China stole voter
    // files, machines "easily compromised", noncitizen/dead voters, mail-in
    // fraud, SAVE Act). Loose high-recall net — Stage-2 selection is the
    // precision gate. No documentUrl: the document is hand-authored and carries
    // its own per-claim in-group sources — the note-writer cites from within it.
    //
    // Shape: an unambiguous standalone phrase, OR an election/voting term paired
    // with a fraud/machine/speech signal or a China signal. The standalone
    // branch exists because the pairing rule alone silently drops posts that
    // name this subject without ever using a voting word ("...doesn't want the
    // Save America Act") or that misspell the one voting word they have.
    id: "trump_election_security",
    title: "Trump election-security speech",
    matches: (t) =>
      ELECTION_STANDALONE.test(t) ||
      (ELECTION_TERM.test(t) && (ELECTION_SIGNAL.test(t) || ELECTION_CHINA.test(t))),
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

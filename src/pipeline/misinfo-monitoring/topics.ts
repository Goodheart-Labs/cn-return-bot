/**
 * Misinformation topics for the XXL-feed pre-pass.
 *
 * Each topic carries three things:
 *  - `matches`: a keyword predicate. Its regexes were ported word for word from
 *    findClaims.py in the investigation, including the word boundary in
 *    `\bai\b`. Without that boundary `ai` also matched words such as "rain" and
 *    "maintain", which inflated the AI-water hits from about 31 to 84.
 *  - `document`: the full article, with nothing distilled away. It is read from
 *    documents/<id>.md when this module is imported, and it is injected into the
 *    bot's research step to ground it.
 *  - `brief`: a distilled debunking brief, read from briefs/<id>.md. It goes
 *    only to the selection LLM that decides which matched posts really need a
 *    note.
 *
 * Every predicate runs against the lowercased blob() from keywordFilter.ts. The
 * regexes are therefore written in lowercase and need no `i` flag.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONCEDE_SHAPE_TOPIC_IDS, type MisinfoTopicId } from "./topicIds";
import { CONCEDE_MARKER } from "./monitoringContext";

export interface MisinfoTopic {
  id: MisinfoTopicId;
  title: string;
  /** The canonical public URL of the reference article, set when the document is
   *  a copy of one. Leave it out for a hand-authored document that carries its
   *  own source for each claim, such as trump_election_security. The note writer
   *  then cites those sources from inside the document instead of citing one
   *  blanket URL. */
  documentUrl?: string;
  matches: (blob: string) => boolean;
  document: string;
  /** The reference the selection LLM matches posts against. For an evergreen
   *  topic this is a distilled debunk. For a time-boxed news event such as
   *  trump_election_security it is the source's transcript itself. */
  brief: string;
}

const HERE = import.meta.dir;
const read = (folder: string, id: string): string =>
  readFileSync(join(HERE, folder, `${id}.md`), "utf8");

// These sub-patterns are shared by several topics. They were ported from
// findClaims.py.
const AI =
  /(\bai\b|\ba\.i\.?|chatgpt|chat gpt|openai|\bllm\b|artificial intelligence|\bgpt\b|gemini|\bgrok\b|chatbot|data ?cent(er|re))/;
const ENERGY =
  /(energy|electricit|\bkwh\b|\bwatt|carbon|emission|\bco2\b|climate|power grid|fossil|environment|footprint|greenhouse)/;
// The trump_election_fraud predicate needs all three of these to match. The
// first is a frame about fraud or tampering. The second is an election object.
// The third anchors the post to 2020 or to the national story. The frame and the
// object on their own matched the whole US election-fraud firehose. That
// included live local races the grounding document cannot speak to, such as the
// 2026 California contests. The anchor narrows the match to the cluster the
// document really debunks: a stolen 2020, 2022 or 2024 election, China, hacked
// machines, noncitizens on the voter rolls, and the declassified documents. On a
// feed of 19.6k posts taken after the speech, the frame and object matched 530
// posts, and adding the anchor brought that down to 391. The anchor only scopes
// the topic. The selection LLM and the brief still do the work of deciding
// whether a claim contradicts the debunk.
const ELECTION_FRAUD_FRAME =
  /(rigged|rig the|stolen|\bstole\b|\bsteal\b|fraud|fraudulent|flip(ped|ping)?|hacked|manipulat|tamper(ed|ing)?|decertif|overturn(ed|ing)?|ballot stuffing|dead voters|noncitizen|non-?citizen|illegal (vote|ballot|voter)|cheat(ed|ing)?)/;
const ELECTION_OBJECT =
  /(election|\bvote[sd]?\b|\bvoting\b|ballot|voter (roll|file|registration|data)|voting machine|dominion|smartmatic|raffensperger|recount)/;
const ELECTION_2020_ANCHOR =
  /(\b20(16|20|22|24)\b|dominion|smartmatic|raffensperger|voting machines?|voter files?|voter rolls?|non-?citizens?|declassif|220 ?million|deep state|decertif|overturn|stolen election|election was stolen|rigged election|chin(a|ese)|foreign (interference|meddl|power)|mail-?in ballot)/;

// ── trump_election_security sub-patterns ────────────────────────────────────
// These were split out of the inline predicate so that each part can be read and
// changed on its own. They all run against the lowercased blob. See
// keywordFilter.

/** Does the post talk about voting at all? This is the context gate for
 *  ELECTION_SIGNAL. */
const ELECTION_TERM =
  /\b(elections?|elected|voters?|voting|votes?|voted|ballots?|registrations?|registered to vote|polling|poll watchers?|swing states?)\b/;

/** Phrases that read as election-integrity claims once ELECTION_TERM is also
 *  present. Every entry marks a claim rather than just a topic. The phrase "2020
 *  election" on its own covers most of the feed's political commentary, so it is
 *  admitted only in the false-victory form "won the 2020 election". */
const ELECTION_SIGNAL =
  /(rigged|stolen|\bstole\b|\bsteal\b|fraud|cheat|hacked|compromis|non-? ?citizens?|illegals? (are|can|can'?t|cannot|vot|regist)|illegal (aliens?|immigrants?|voters?) [a-z ]{0,20}(vot|regist)|illegal (vote|ballot)|dominion|smartmatic|maduro|venezuela|decertif|declassif|deep state|mail[- ]?in|through the mail|voter (roll|file|data|id)|voting machine|tabulator|dead voters?|duplicate registration|proof of citizenship|birth certificate|driver'?s licen[sc]e|election (security|integrity|monitors?|observers?)|monitoring elections|polling (site|place)|220 ?million|(won|winning) the 20(20|24) election|\b2[5-8]\d,?\d{3}\b|\b2[5-8]\d ?thousand\b|quarter[- ](of a )?million|cover[- ]?up|covered (it|this|that) up|cover story|to count the votes?|third world country)/;

/** These phrases match on their own, with no election term needed, because each
 *  one has a single subject. The last three come from the coverup lore in the
 *  speech. The claim-coverage audit on 7/24 found 29 posts with 3.4M impressions
 *  that were missed, because posts like "an fbi official admitted running a
 *  shadow government" often carry no voting word at all. Ordinary uses of these
 *  phrases that have nothing to do with the speech do slip through here. Stage 2
 *  is the precision gate, and the volume seen here is about 4 posts a day. */
const ELECTION_STANDALONE =
  /(save america act|\bsave act\b|dominion voting|smartmatic|220 ?million|278,?000|burn bags?|shadow government|presidential daily brief)/;

/** The speech's claim that China acquired voter files. This pattern is paired
 *  with ELECTION_TERM because these words on their own are nowhere near specific
 *  enough. */
const ELECTION_CHINA = /(china|chinese|beijing|\bccp\b|people's republic)/;

/** The speech's claims about Chinese influence operations in 2018 and 2019. It
 *  said China paid US journalists for negative coverage and pressured business
 *  leaders into turning against the president. Posts about this routinely carry
 *  no voting word, so ELECTION_TERM cannot be the gate. Such a post has to match
 *  China, a target, and an operations verb instead. */
const CHINA_INFLUENCE_TARGET = /(journalists?|business leaders?|\bceos?\b)/;
const CHINA_INFLUENCE_VERB = /(\bpaid?\b|\bpay(ing)?\b|large sums|pressur|influenc|turn against|hit pieces?|negative (stories|articles|coverage))/;

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
    // This topic is the myth that training a model emitted a catastrophic amount
    // of CO2, which the viral 626,000-pound chart spread. ai_energy_carbon is
    // about the energy one use costs instead. The requirement for \btrain\b is
    // what tells the two apart. This topic is listed before ai_energy_carbon so
    // that a post matching both is processed under this one, because the first
    // matching topic wins.
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
    // The dismissal that effective altruism has accomplished nothing. The first
    // clause anchors on effective altruism terms. Bare "ea" is deliberately left
    // out because it collides with the game studio. The second clause requires
    // negative framing. The selection LLM is the precision step. It is what
    // excludes fair criticism of specific effective altruism failures.
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
    // Trump's primetime election-security speech of July 2026. He claimed that
    // China stole voter files, that machines were "easily compromised", that
    // noncitizens and dead people voted, and that mail-in voting was
    // fraudulent, and he pushed the SAVE Act. This predicate is a loose net that
    // favours recall. Stage 2 of selection is the precision gate. There is no
    // documentUrl because the document is hand-authored and carries its own
    // source for each claim, so the note writer cites from inside it.
    //
    // A post matches in one of two shapes. Either it contains an unambiguous
    // standalone phrase, or it contains an election or voting term together with
    // a fraud, machine or speech signal, or with a China signal. The standalone
    // branch exists because the pairing rule on its own silently drops posts.
    // Some of them name this subject without ever using a voting word, as in
    // "...doesn't want the Save America Act". Others misspell the single voting
    // word they have.
    id: "trump_election_security",
    title: "Trump election-security speech",
    matches: (t) =>
      ELECTION_STANDALONE.test(t) ||
      (ELECTION_TERM.test(t) && (ELECTION_SIGNAL.test(t) || ELECTION_CHINA.test(t))) ||
      (ELECTION_CHINA.test(t) && CHINA_INFLUENCE_TARGET.test(t) && CHINA_INFLUENCE_VERB.test(t)),
  },
  {
    // The narrative that the 2020 election, or the 2022 or 2024 one, was stolen
    // or rigged or flipped. Trump's address about declassified documents on 16
    // July 2026 revived it. This topic corrects only the narrow factual claim
    // that an outcome was changed. It does not correct opinions or views on
    // election-security policy. The brief is where that line is drawn.
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

// A topic enrolled in the concede-then-correct experiment must wrap the
// experiment's additions in concede-shape marker lines in its document.
// Without them the "on" arm's writer rule would point at a section that does
// not exist. We check this at load time, so a mismatch fails the run loudly
// instead of producing broken prompts.
for (const id of CONCEDE_SHAPE_TOPIC_IDS) {
  const topic = MISINFO_TOPICS.find((t) => t.id === id);
  if (!topic?.document.includes(CONCEDE_MARKER)) {
    throw new Error(
      `Topic "${id}" is enrolled in CONCEDE_SHAPE_TOPIC_IDS but its document has no "${CONCEDE_MARKER}" block`,
    );
  }
}

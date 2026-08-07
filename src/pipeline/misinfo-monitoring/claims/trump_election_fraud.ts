/**
 * Structured claim map for the `trump_election_fraud` topic.
 *
 * Why this exists.
 * The prose grounding document in documents/trump_election_fraud.md grounds the
 * note-writer's research, but the bot still runs a live web search and a source
 * verification for every note. On a topic like this one most tweets recycle the
 * same small set of claims. Examples are the 220 million voter files taken by
 * China, the 278,000 noncitizens, the hacked voting machines, and Georgia. Those
 * claims should not be researched from scratch every time.
 *
 * Each recurring claim gets one entry here. An entry records the claim's grain of
 * truth, its correction, the sources a human has already vetted, and a note that
 * is ready to post.
 *
 * The intended flow is not wired up yet. A tweet would be matched to a claim
 * through the entry's `match` keywords. On a hit the note-writer would be handed
 * the entry, would skip the live search, and would cite the vetted sources
 * directly. On a miss it would fall back to the live search the bot runs today,
 * which covers the long tail of novel claims.
 *
 * The sources here were gathered and read during research on 2026-07-17, and
 * Nathan vets them. This map only holds claims that can be corrected. The rule for
 * what counts as misleading in the first place lives in
 * briefs/trump_election_fraud.md, and that is where the exclusions for debunks and
 * opinion stay.
 */

export interface ClaimSource {
  url: string;
  /** One line on what this source establishes. It is the reviewer's audit trail. */
  supports: string;
}

export interface ClaimEntry {
  id: string;
  /** Canonical statement of the misleading claim. */
  claim: string;
  /** Lowercase keywords and phrases that identify a tweet as making this claim. A
   *  tweet is a candidate for this entry when it hits several of them. How many
   *  count as several is the matcher's decision. */
  match: string[];
  /** The part of the claim that is actually true. Saying it keeps the correction
   *  honest instead of a blanket "false". It also answers the reader who would
   *  otherwise reply that the claim has something to it. Optional. */
  grainOfTruth?: string;
  /** The core factual rebuttal, in plain language. */
  correction: string;
  /** Citations a human has already vetted. The note cites these directly, and no
   *  live search runs. */
  sources: ClaimSource[];
  /** A Community Note that is ready to post. It is the correction followed by the
   *  source URLs, and it is kept short. */
  note: string;
}

export interface ClaimMap {
  topicId: string;
  /** The single fact that every entry ultimately rests on. */
  throughLine: string;
  claims: ClaimEntry[];
}

const CBS = "https://www.cbsnews.com/news/trump-election-primetime-speech-declassified-documents-revisits-disputed-claims/";
const CNN = "https://www.cnn.com/2026/07/16/politics/what-trumps-newly-declassified-documents-do-and-dont-tell-us-about-threats-to-us-elections";
const MSNOW = "https://www.ms.now/news/trump-speech-election-stolen";
const GA_SOS = "https://sos.ga.gov/news/historic-first-statewide-audit-paper-ballots-upholds-result-presidential-race";
const NPR_GA = "https://www.npr.org/sections/live-updates-2020-election-results/2020/11/19/936647882/georgia-releases-hand-recount-results-affirming-bidens-lead";

export const TRUMP_ELECTION_FRAUD_CLAIMS: ClaimMap = {
  topicId: "trump_election_fraud",
  throughLine:
    "No evidence — including the government's own newly declassified documents — shows any vote was changed or any 2020/2022/2024 outcome altered. Trump task-force appointee John Solomon conceded the IC has \"zero evidence that a foreign power flipped a vote,\" and the White House conceded the documents don't allege switched votes or hacked machines.",
  claims: [
    {
      id: "china_220m_voter_files",
      claim: "China stole/hacked 220 million US voter files — the largest election-data compromise in history.",
      match: ["220 million", "voter files", "voter data", "china", "chinese", "compromise of election data"],
      grainOfTruth:
        "China did obtain voter-registration data from several states around 2020; some of it was purchased through legal means.",
      correction:
        "US voter-registration files are largely public and cheap to buy, so acquiring them gives no ability to cast or change votes. The intelligence describes the data being used for opinion analysis, and nothing shows any 2020 result was altered.",
      sources: [
        { url: CBS, supports: "Voter files are public (expert David Becker); no evidence any result was manipulated." },
        { url: CNN, supports: "Declassified documents do not show any votes were changed." },
      ],
      note:
        "US voter-registration files are largely public and can be bought cheaply, so acquiring them doesn't let anyone cast or change votes. The declassified material shows no 2020 result was altered. " + CBS,
    },
    {
      id: "china_changed_outcome",
      claim: "China \"fought like hell\" / meddled to change the 2020 outcome and stop Trump winning.",
      match: ["china", "chinese", "fought like hell", "meddl", "interfere", "xi jinping", "hurt trump", "prevent trump"],
      grainOfTruth:
        "China has run influence operations (social-media narratives) in US election cycles.",
      correction:
        "The 2021 Intelligence Community Assessment / National Intelligence Council found China stayed neutral in 2020 and did not try to change the outcome; only a minority view held it sought to denigrate Trump, and only via social media — not by touching votes.",
      sources: [
        { url: CBS, supports: "NIC assessed China stayed neutral; minority view only, social-media not vote-changing." },
        { url: CNN, supports: "No foreign actor altered vote casting/tabulation in 2020." },
      ],
      note:
        "US intelligence assessed China stayed neutral in 2020 and did not try to change the outcome; a minority view held it criticized Trump only through social media. No votes were altered. " + CBS,
    },
    {
      id: "noncitizens_on_rolls",
      claim: "~278,000 (or 250,000) noncitizens are illegally registered / noncitizen voting decided elections.",
      match: ["noncitizen", "non-citizen", "278,000", "278000", "250,000", "illegally registered", "voter rolls", "dhs"],
      grainOfTruth:
        "Voter rolls do contain errors, and a small number of noncitizen registrations have been found in list audits.",
      correction:
        "The ~278k figure is unverified and disputed as inflated by false positives, deceased, and eligible voters. Documented noncitizen VOTING is minuscule — Georgia's 2024 audit found 20 noncitizens among 8.2 million voters. Being listed on a roll is not casting a decisive vote.",
      sources: [
        { url: CBS, supports: "Becker: take DHS numbers with a grain of salt; GA 2024 audit 20 of 8.2M; Brennan 30 of 23.5M." },
      ],
      note:
        "The ~278,000 figure is unverified and likely inflated by false positives and eligible voters. Documented noncitizen voting is extremely rare — Georgia's 2024 audit found 20 among 8.2 million voters. " + CBS,
    },
    {
      id: "voting_machines_hacked",
      claim: "US voting machines are extremely exposed / easily hacked (Venezuela, Smartmatic).",
      match: ["voting machine", "smartmatic", "venezuela", "hacked", "ballot-counting", "rig the vote", "flip", "tabulat"],
      grainOfTruth:
        "Adversaries have the general capability to probe election infrastructure (a January 2020 NIC memo).",
      correction:
        "The cited Venezuela/Smartmatic systems aren't used in US elections (Smartmatic only in LA County). US tabulators aren't internet-connected and are backed by auditable paper ballots — manipulating them at scale would be caught by audits. Georgia counted every 2020 ballot three times and confirmed the result.",
      sources: [
        { url: CBS, supports: "Smartmatic not used in US; machines paper-backed/offline; GA counted every ballot 3×." },
        { url: GA_SOS, supports: "Statewide hand audit on human-readable text upheld the presidential result." },
      ],
      note:
        "The cited Venezuela/Smartmatic systems aren't used in US elections. US machines are offline and backed by paper ballots; Georgia hand-counted every 2020 ballot and confirmed the result three separate times. " + GA_SOS,
    },
    {
      id: "michigan_gotv_fraud",
      claim: "A Michigan Democratic GOTV group committed voter fraud and the Biden DOJ buried it.",
      match: ["michigan", "muskegon", "get-out-the-vote", "gotv", "registration", "forged", "doj", "slow-walk"],
      grainOfTruth:
        "Fraudulent registration APPLICATIONS were in fact submitted in Muskegon County, Michigan.",
      correction:
        "Those fraudulent registration applications were detected and caught before any fraudulent vote was cast — state officials confirmed the system worked and no fraudulent votes resulted. The allegations have been public for years.",
      sources: [
        { url: CBS, supports: "Officials: questionable registrations caught before any fraudulent vote; known for years." },
      ],
      note:
        "In the Michigan case, fraudulent registration applications were submitted but caught before any fraudulent vote was cast — officials confirmed no fraudulent votes resulted. " + CBS,
    },
    {
      id: "declassified_proves_stolen",
      claim: "The newly declassified documents prove the 2020 election was rigged/stolen.",
      match: ["declassif", "documents prove", "rigged", "stolen", "deep state", "cover", "cia docs", "bombshell"],
      correction:
        "The White House itself conceded the documents don't allege any votes were switched or any machine hacked. Trump's own task-force appointee John Solomon said the intelligence community has \"zero evidence that a foreign power flipped a vote in 2020, '22 or '24.\"",
      sources: [
        { url: MSNOW, supports: "Solomon (Trump appointee): zero evidence a vote was flipped; WH conceded no switched votes." },
        { url: CNN, supports: "None of the declassified information supports any result being altered." },
      ],
      note:
        "The White House acknowledged these documents don't allege any votes were switched or machines hacked, and Trump's own task-force appointee John Solomon said there's \"zero evidence\" a foreign power flipped a vote in 2020. " + MSNOW,
    },
    {
      id: "georgia_2020_stolen",
      claim: "Georgia's 2020 result was stolen / Dominion flipped votes for Biden.",
      match: ["georgia", "dominion", "raffensperger", "11,780", "11,779", "recount", "flipped votes"],
      correction:
        "Georgia's 2020 result was verified three ways — the initial machine count, a full statewide hand audit of every ballot (using human-readable text, not Dominion scanners), and a Trump-requested recount — all affirming Biden by 11,779. Republican Secretary of State Brad Raffensperger ran the hand count specifically to answer Dominion doubts.",
      sources: [
        { url: GA_SOS, supports: "Risk-Limiting Audit hand-tally upheld the result; highest county error 0.73%." },
        { url: NPR_GA, supports: "Hand recount affirmed Biden's lead." },
      ],
      note:
        "Georgia checked its 2020 result three times — machine count, a full hand audit of every ballot, and a Trump-requested recount — all confirming Biden by 11,779. The hand count didn't rely on Dominion scanners. " + GA_SOS,
    },
    {
      id: "dead_voters",
      claim: "Large numbers of dead people voted in 2020.",
      match: ["dead voters", "dead people", "deceased", "voted after death"],
      correction:
        "Post-2020 investigations found only a handful of ballots cast in deceased people's names (about 4 in Georgia, 1 in Arizona) — far too few to affect any result, and several were clerical errors.",
      sources: [
        { url: CBS, supports: "Dead-voter cases: ~4 in Georgia, 1 in Arizona; some clerical." },
      ],
      note:
        "Post-2020 investigations found only a handful of ballots cast in deceased people's names (about 4 in Georgia, 1 in Arizona) — far too few to affect any result, and often clerical errors. " + CBS,
    },
  ],
};

/**
 * Import new scraped notes from markdown file into scraped_notewriter_notes table
 * Run with: bun run src/scripts/importNewScrapedNotes.ts
 */

import { getSupabaseClient } from "../api/supabaseClient";

interface NoteData {
  note_id: string;
  tweet_id: string;
  note_text: string;
  cn_status: string;
  view_count?: number;
}

// Manually collected notes already imported into Supabase (one-shot script, Jan 2026)
const notes: NoteData[] = [
  {
    note_id: "2012678261562576959",
    tweet_id: "2012574320048947593",
    note_text: "False. Japan has not banned Israeli tourists. This claim stems from isolated hotels refusing Israeli guests—not government policy. Japanese authorities issued warnings that such refusals violate discrimination laws. Israel remains on Japan's visa exemption list.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013185766944354586",
    tweet_id: "2013077731538333864",
    note_text: "The trucker exodus is due to AB5, a 2019 labor law reclassifying independent contractors as employees—not a diesel emissions bill. California's diesel truck rule (Advanced Clean Fleets) was withdrawn in Jan 2025 and didn't cause boycotts.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013170513523204346",
    tweet_id: "2013052837022794054",
    note_text: "This claim is false. Recent US deployments to Greenland involved only 2 F-35s and 2 F-16s in an Oct 2025 exercise—not \"dozens.\" No F-22s have been deployed there. Recent Danish F-16 patrols are Danish aircraft, not US.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013160705726591215",
    tweet_id: "2013044062845059173",
    note_text: "This post is fabricated. Texas has only 38 congressional districts, not 43. Chuck Norris has not filed any candidacy paperwork with the FEC. No incumbent named \"Jon Raebro\" exists in any Texas district.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013130605949546504",
    tweet_id: "2013015629444383049",
    note_text: "False. A 2014 Fred Hutchinson study of 1,500+ women found no link between bras and breast cancer—regardless of hours worn, underwire, or cup size. The American Cancer Society confirms no scientific basis for this claim.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013050851091210623",
    tweet_id: "2012786126159835593",
    note_text: "False. Fauci's wife is Christine Grady, a bioethicist born in NJ to John and Barbara Grady. She has no relation to Ghislaine Maxwell or the Maxwell family.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013002262503997686",
    tweet_id: "2012560545753272381",
    note_text: "This claim is based on a debunked hoax. A viral TikTok falsely linked \"good morning\" to slavery; the creator later retracted it. Historians confirm the phrase predates slavery by centuries. No credible sources consider it racist.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012994226124931485",
    tweet_id: "2012787609282760865",
    note_text: "False. UAE officially condemned Israeli strikes on Iran \"in strongest terms\" on June 13, 2025. UAE also restricts US aircraft at Al Dhafra Air Base from launching strikes, forcing US to redirect jets to Qatar instead.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012896891134976251",
    tweet_id: "2012782388611350983",
    note_text: "The post falsely implies a Jeep Wrangler painted with Vantablack exists. No factory vehicle uses Vantablack. The referenced products are aftermarket wraps/sunshades labeled \"Vantablack,\" not the original material.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012896782238298510",
    tweet_id: "2012842228696129875",
    note_text: "The claim that \"ICE now raiding schools during class\" is false. ICE agents did not raid schools or classrooms; they stopped St. Paul Public Schools contracted transport vans en route to school, and the vans continued without disruption after staff followed protocols.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012868797514842596",
    tweet_id: "2012561749619216820",
    note_text: "The claim \"ICE arrested this man for refusing to show his ID\" is false. Sackie voluntarily showed his driver's license but lacked additional citizenship proof, leading to detention—not arrest—for further investigation.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2013214074813722849",
    tweet_id: "2012616427186815201",
    note_text: "The US **suspended** aid to Somalia's federal government—not permanently ended all foreign aid. Resumption is possible if Somalia takes accountability steps. Aid to non-government entities may continue.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012858409716998482",
    tweet_id: "2012697152720396339",
    note_text: "The video shows Tony Romo during a Bills victory, not a loss. Reports confirm Romo was criticized for his commentary and \"bizarre noises\" during the game, but there is no evidence of him throwing papers or reacting to Josh Allen \"falling short.\"",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012836672639992089",
    tweet_id: "2012670305727095088",
    note_text: "This video's claim that Cavill rejected a $50M Clooney film over \"woke culture\" is fabricated. No such offer existed. The story originated from unverified social media posts with no confirmation from Cavill, Clooney, or any studio.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012807137399865491",
    tweet_id: "2012591439314669839",
    note_text: "Florida's SB 56 bans geoengineering/weather modification, not contrails. These trails are normal condensation—water vapor freezing at altitude. Contrails can persist for hours in humid air. This is basic physics, not chemical spraying.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 241900,
  },
  {
    note_id: "2012717993990533314",
    tweet_id: "deleted", // Post deleted
    note_text: "This claim is false. No \"Blue States Only\" tour exists. This originated from satire/misinformation. The Eras Tour's U.S. leg ended Nov 3, 2024 in Indianapolis, with only Canada dates remaining. No manager confirmed any sales slump.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
  },
  {
    note_id: "2012655253129470253",
    tweet_id: "2012389527642325400",
    note_text: "Michael Rapaport is alive. His Wikipedia page confirms ongoing activities through 2026, including appearing on The Traitors. No credible reports of his death exist. CNN has not reported this.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012639649173483679",
    tweet_id: "2012549923888140391",
    note_text: "The claim \"no one is allowed to talk about it\" is false. Macron publicly addressed his red eye during his Jan 16 speech, joking it was \"completely harmless.\" The event was widely covered by international media.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012631893070463472",
    tweet_id: "2012537103167398281",
    note_text: "The 95% drop claim is misleading. The $0.40 figure refers to wholesale prices, not what consumers pay. Retail egg prices averaged $6.23/dozen in March 2025 and remain elevated. Wholesale prices fell ~50% from January highs—not 95%.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012609093190463994",
    tweet_id: "deleted", // Post deleted
    note_text: "This post shares a fabricated quote and incident. David Muir never \"snapped\" on air with this statement. Snopes traced this claim to a blog post containing AI-generated misinformation and rated it false. The dramatic studio scene described never occurred.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012601697827217900",
    tweet_id: "2012340727829737790",
    note_text: "Misleading. Chemo effectiveness varies by cancer type. Meta-analysis of late-stage cancers found 35.3% response rate, not 3%. In ALL/CML, 10-year survival reached 80.7% with continued therapy. The \"97% failure\" claim originates from debunked low-quality sources.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 17500,
  },
  {
    note_id: "2012596085357768897",
    tweet_id: "2011980804918804782",
    note_text: "Chiropractors earn a Doctor of Chiropractic (DC), not an MD or DO. These are separate degrees with different training: DCs lack the 2-8 year residency, prescribing authority, and surgical training required of MDs/DOs. No cases exist where chiropractors hold MD degrees.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012556285309305279",
    tweet_id: "2012493228709142757",
    note_text: "The Robinhood CEO did not sell \"all his shares.\" SEC filings confirm he sold 375,000 shares on January 5, 2026, but retains significant holdings.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012520085387354148",
    tweet_id: "2012488033057288518",
    note_text: "False. Japan has not banned Israeli tourists. This claim stems from isolated hotel incidents, not government policy. Israelis remain eligible for visa-free entry up to 90 days. Japanese authorities warned hotels that nationality-based refusals could be discrimination.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
  },
  {
    note_id: "2012520058132853123",
    tweet_id: "2012187772610814165",
    note_text: "Post claims Joan García has 6 UCL games, 11 goals conceded. UEFA official stats show 3 matches, 5 goals conceded, 0 clean sheets in 2024/25 Champions League.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 1500,
  },
  {
    note_id: "2012428330436333955",
    tweet_id: "2012377006164332710",
    note_text: "Apollo 11 landed on the Moon July 20, 1969. Apollo did use computers (the Apollo Guidance Computer). Evidence includes lunar rocks verified by scientists worldwide and independent transmission confirmation by Australia's Parkes Observatory.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 12500,
  },
  {
    note_id: "2012415282870976747",
    tweet_id: "2012163688707522902",
    note_text: "Stan Nelson was the last survivor of his ship (USS LCI 492), not of D-Day itself—~156,000 troops participated. He also died Nov 20, 2025, not yesterday.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012371392902332840",
    tweet_id: "2012056930743697677",
    note_text: "The post claims an off-duty ICE agent was detained by ICE. This is false. The person detained at the St. Paul gas station was Orbin Mauricio Henriquez-Serrano, a 27-year-old undocumented man from Honduras with a 2020 removal order—not an ICE agent.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012349129146442011",
    tweet_id: "2012195263352611312",
    note_text: "Claims that copper \"restores charge\" or brings water to a \"living state\" have no scientific basis. Copper does have antibacterial effects (killing bacteria after 16-24 hours), but extended storage can leach copper beyond safe WHO limits, risking nausea and organ damage.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012325976831615094",
    tweet_id: "2012019296344621149",
    note_text: "Trump did post this AI video but deleted it hours later—it's no longer on his page. The White House called it \"a meme.\" Medbeds are a debunked conspiracy theory with no scientific basis; scammers have used this post to solicit money.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012299686455955655",
    tweet_id: "2012120097499046023",
    note_text: "False. Rothschild & Co. voluntarily suspended its Russia office in March 2022 due to Western sanctions over Ukraine—not any expulsion by Putin. Fact-checkers confirm the Rothschilds never controlled Russia's central bank or monetary policy.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012284829274968559",
    tweet_id: "2012231196713927137",
    note_text: "This is a debunked hoax. There's no \"Project Anchor\" leak, no $89B NASA budget for this, and gravity cannot \"turn off\" - it's a physical result of Earth's mass. The claim originated from an unsourced TikTok video in Nov 2024.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 213600,
  },
  {
    note_id: "2012179017135263811",
    tweet_id: "2011925541104783697",
    note_text: "Rothschild co-founded (not created) the British Relief Association with others. The £500,000+ was raised collectively through public subscriptions, not £600,000 from his personal funds.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012158672235884992",
    tweet_id: "deleted", // Post deleted
    note_text: "This is misleading. A cease & desist under § 1692c(c) only stops collectors from contacting you—it doesn't remove collections from your credit report. CFPB complaints also don't auto-delete debts. Valid collections stay on reports up to 7 years under FCRA.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012151678481412283",
    tweet_id: "2011891553850343866",
    note_text: "Tarrio is not an ICE agent. He denied this rumor, calling his social media post \"obviously satire.\" He created ICERAID, a private app for reporting undocumented immigrants—but that doesn't make him an ICE employee.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012073257881436196",
    tweet_id: "2011986754627387863",
    note_text: "**Correction:** The 67% figure refers to Chinese share of \"foreign-owned\" properties (~27,000 of 40,000+), not all Australian homes. Australia has millions of homes; foreign-owned properties are a tiny fraction. No evidence supports the tax dodging claim.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2012066905306063093",
    tweet_id: "2011993694468280608",
    note_text: "Shiloh dropped \"Pitt\" but kept \"Jolie\" (her mother's name), so she isn't \"separating from her parents.\" The claim she did this \"to show the world how unique and special she is\" is fabricated—court documents don't state her reasons.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011974674045870214",
    tweet_id: "2011925119417946256",
    note_text: "False. Multiple US cities cut police budgets in 2020-21: NYC ($1B), LA ($150M), Austin (~30%), Minneapolis ($8M), DC ($15M), Baltimore ($22M). Many cuts were later reversed, but defunding did occur.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011953751515390158",
    tweet_id: "2011563726726709324",
    note_text: "ICE is allowed to remove people from cars, as seen in St. Paul, MN, on Jan 11, 2026, when agents broke a car window to arrest a non-compliant individual.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011931064344670631",
    tweet_id: "2011705542495043910",
    note_text: "Alyssa Carson is not training with NASA or any space agency. NASA has stated she is not affiliated with any space program. Her involvement was attending space camps and educational programs. She is currently a PhD candidate in biology at the University of Arkansas.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
  },
  {
    note_id: "2011901297394372740",
    tweet_id: "2011862784464576803",
    note_text: "Misleading: NASA's actual estimate for asteroid 2023 DW is 1 in 560 (0.18%), not 2%. Updated odds are even lower at 1 in 770 (0.13%). The post overstates the risk by more than 10x.",
    cn_status: "CURRENTLY_RATED_HELPFUL",
    view_count: 286800,
  },
  {
    note_id: "2011901236769878448",
    tweet_id: "2011513654055760322",
    note_text: "The image shows a large South American sea lion that barged into a Chilean fish market and boldly approached fishermen—not a \"little\" sea lion that \"waits patiently\" and \"never steals.\" The heartwarming story appears fabricated.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011892124644450766",
    tweet_id: "2011815877147054522",
    note_text: "The claim that Carrefour is offering 20% discounts on Bitcoin payments is false as a general company policy; this initiative is restricted to a single Carrefour Express franchise location in Arcachon, France, and is not available across the chain's 14,000 global stores.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011885817963135373",
    tweet_id: "2011519558264504479",
    note_text: "The $30M figure is Omar and her husband's **combined** net worth, not hers alone. The increase came primarily from her spouse's business stakes in Rose Lake Capital and a winery, not her salary. Omar states she is not individually a millionaire.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011810905391317228",
    tweet_id: "2011670460308865089",
    note_text: "The shooting occurred outside the home, not \"thru his front door.\" The man was shot in the leg during a confrontation outside after he and two others attacked an ICE agent with a snow shovel and broom handle. He then entered and barricaded himself inside.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
  {
    note_id: "2011726676221444213",
    tweet_id: "2011259676344926495",
    note_text: "ChatGPT-5 doesn't exist. The \"landmark study\" is the McCullough Foundation report—not peer-reviewed, and analysis shows 79% of its cited studies don't support a vaccine-autism link. WHO's 2025 review of 31 studies reaffirms no causal link.",
    cn_status: "NEEDS_MORE_RATINGS",
  },
];

async function main() {
  console.log(`Importing ${notes.length} notes into scraped_notewriter_notes...`);

  const client = getSupabaseClient();

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const note of notes) {
    // Check if note already exists
    const { data: existing } = await client
      .from("scraped_notewriter_notes")
      .select("note_id")
      .eq("note_id", note.note_id)
      .single();

    if (existing) {
      console.log(`Skipping ${note.note_id} - already exists`);
      skipped++;
      continue;
    }

    // Insert into scraped_notewriter_notes
    const { error: noteError } = await client
      .from("scraped_notewriter_notes")
      .insert({
        note_id: note.note_id,
        tweet_id: note.tweet_id,
        note_text: note.note_text,
      });

    if (noteError) {
      console.error(`Error inserting note ${note.note_id}:`, noteError);
      errors++;
      continue;
    }

    // Also insert a snapshot with current status
    const { error: snapshotError } = await client
      .from("scraped_notewriter_snapshots")
      .insert({
        note_id: note.note_id,
        cn_status: note.cn_status,
        view_count: note.view_count,
      });

    if (snapshotError) {
      console.error(`Error inserting snapshot for ${note.note_id}:`, snapshotError);
      // Don't count as error since note was inserted
    }

    console.log(`Inserted ${note.note_id}`);
    inserted++;
  }

  console.log(`\nDone!`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

main().catch(console.error);

/* The facts every homepage direction shows, so the directions differ only in
 * their look. The notes, the claims and the pipeline numbers are real and were
 * read from the production database on 28 September 2026. */

export const STORE_LINKS = {
  chrome: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/common-notes/",
  edge: "https://chromewebstore.google.com/detail/common-notes/jodkhmefbcmgldokmeicpdogkepmcnij",
} as const;

export type BrowserId = "chrome" | "firefox" | "edge" | "safari";

export interface Browser {
  id: BrowserId;
  name: string;
  /** Missing while the browser has no version of the extension yet. */
  href?: string;
  /** How installing works in that browser, in one sentence. */
  how: string;
}

export const BROWSERS: Browser[] = [
  { id: "chrome", name: "Chrome", href: STORE_LINKS.chrome, how: "Add it from the Chrome Web Store. It is free and needs no account." },
  { id: "firefox", name: "Firefox", href: STORE_LINKS.firefox, how: "Add it from Firefox Add-ons. It is free and needs no account." },
  { id: "edge", name: "Edge", href: STORE_LINKS.edge, how: "Edge installs extensions from the Chrome Web Store. Allow extensions from other stores when Edge asks." },
  { id: "safari", name: "Safari", how: "A Safari version is coming. Until then, Chrome, Firefox and Edge work." },
];

/** A note as the directions show it, with the passage it is anchored to. */
export interface DemoNote {
  creator: string;
  postTitle: string;
  postUrl: string;
  published: string;
  /** The passage around the claim. `quote` is the part the note is about. */
  before: string;
  quote: string;
  after: string;
  note: string;
  sources: { label: string; url: string }[];
  votes: { helpful: number; somewhat: number; notHelpful: number };
}

export const ZVI_NOTE: DemoNote = {
  creator: "Don't Worry About the Vase",
  postTitle: "AI #176 Part 1: Doing It Live",
  postUrl: "https://thezvi.substack.com/p/ai-176-part-1-doing-it-live",
  published: "9 July 2026",
  before: "The problem is invalidating grades entirely. ",
  quote: "At UC Berkeley, the number of As is up by 30%, so GPAs are dangerously close to meaningless for measuring student quality.",
  after: "",
  note:
    "This 30% figure comes from a UC Berkeley researcher's study, but it measured grades at an unnamed Texas university's AI-exposed courses, not UC Berkeley's own grades. Actual UC Berkeley data shows A rates stayed stable at 30-35% from 2019 to 2026.",
  sources: [
    { label: "cshe.berkeley.edu", url: "https://cshe.berkeley.edu/publications/artificial-intelligence-and-grade-inflation-cshe-higher-education-working-paper-series" },
    { label: "dailycal.org", url: "https://www.dailycal.org/news/campus/academics/uc-berkeley-shows-no-signs-of-ai-grade-inflation-as-professors-adapt/article_6da85b38-889f-4f80-835a-88cc54a81662.html" },
  ],
  votes: { helpful: 5, somewhat: 0, notHelpful: 0 },
};

export const ACX_NOTE: DemoNote = {
  creator: "Astral Codex Ten",
  postTitle: "Contra Pritchard On Liberal Happiness",
  postUrl: "https://www.astralcodexten.com/p/contra-pritchard-on-liberal-happiness",
  published: "21 July 2026",
  before: "(although both are still within the liberal mainstream, and ",
  quote: "no country outside the liberal mainstream has ever managed to equal current US happiness levels. The closest near-misses are Singapore at 6.5, and Saudi Arabia at 6.6.",
  after: ")",
  note:
    "In the 2026 World Happiness Report, Saudi Arabia (6.817) and the UAE both ranked above the US (6.816), not below it as \"near-misses\" at 6.6. The UAE also outranked the US in the 2025 report (6.76 vs 6.724).",
  sources: [
    { label: "saudigazette.com.sa", url: "https://saudigazette.com.sa/article/659973" },
    { label: "mappr.co", url: "https://www.mappr.co/world-happiness-report-ranking/" },
    { label: "arabnews.com", url: "https://www.arabnews.com/node/2594426/middle-east" },
  ],
  votes: { helpful: 5, somewhat: 0, notHelpful: 0 },
};

/** What the pipeline did between 29 August and 28 September 2026. */
export const PIPELINE_30_DAYS = {
  period: "29 August to 28 September 2026",
  posts: 1216,
  claimsExtracted: 72919,
  claimsChecked: 14128,
  notes: 1193,
};

/** Notes per week written by the pipeline, from the week of 6 July 2026.
 *  The last week has only one day in it, so it is left out. */
export const NOTES_PER_WEEK: { week: string; notes: number }[] = [
  { week: "6 Jul", notes: 19 },
  { week: "13 Jul", notes: 21 },
  { week: "20 Jul", notes: 10 },
  { week: "27 Jul", notes: 0 },
  { week: "3 Aug", notes: 48 },
  { week: "10 Aug", notes: 36 },
  { week: "17 Aug", notes: 59 },
  { week: "24 Aug", notes: 53 },
  { week: "31 Aug", notes: 123 },
  { week: "7 Sep", notes: 170 },
  { week: "14 Sep", notes: 450 },
  { week: "21 Sep", notes: 418 },
];

export const PITCH =
  "Our claim-checking pipeline writes notes on the Substack posts and YouTube videos our readers visit, and the extension shows each note right on the page. Notes that a diverse set of readers rate helpful are shown more prominently.";

/** The two links Jim's sketch asks for. The addresses are still to come. */
export const READING = [
  { title: "The Forethought blog post", kind: "Blog post", source: "Forethought", href: "#forethought" },
  { title: "The Community Notes TED talk", kind: "Talk", source: "TED", href: "#ted" },
] as const;

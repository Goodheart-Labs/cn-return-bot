import type { PageItem } from "@cn/core/items";
import type { ClaimRef, FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { queryKeys } from "@cn/features/query/queryKeys";

/* A small, made-up data set that covers every state a note can be in. The
 * creator, the posts and the notes are fictional, so the stories never depend
 * on what production holds today. */

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

/** A made-up creator picture, drawn inline so no story needs the network. */
const AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#1e3a8a"/><text x="60" y="78" text-anchor="middle" font-family="Georgia" font-size="56" fill="#f9fafb">WL</text></svg>',
  );

export const PROJECT: FeedProjectRow = {
  id: "project-1",
  slug: "the-weekly-ledger",
  name: "The Weekly Ledger",
  feed_url: "https://weeklyledger.substack.com",
  avatar_url: AVATAR,
  vote_score: 12,
  note_count: 4,
};

export const PROJECTS: FeedProjectRow[] = [
  PROJECT,
  { id: "project-2", slug: "signal-and-noise", name: "Signal and Noise", feed_url: "https://www.youtube.com/@signalandnoise", avatar_url: null, vote_score: 8, note_count: 27 },
  { id: "project-3", slug: "a-careful-reader", name: "A Careful Reader", feed_url: "https://www.lesswrong.com/users/careful-reader", avatar_url: null, vote_score: 5, note_count: 9 },
  { id: "project-4", slug: "web", name: "Around the web", feed_url: null, avatar_url: null, vote_score: 3, note_count: 14 },
];

export const ITEMS: FeedItemRow[] = [
  { id: "item-1", project_id: PROJECT.id, url: "https://weeklyledger.example.com/p/the-housing-numbers", title: "The housing numbers nobody reads", published_at: daysAgo(2), created_at: daysAgo(2) },
  { id: "item-2", project_id: PROJECT.id, url: "https://weeklyledger.example.com/p/what-the-grid-can-take", title: "What the grid can take", published_at: daysAgo(9), created_at: daysAgo(9) },
];

/** A small chart as an inline image, so the image-grounded claim renders
 *  without a network request. */
export const CHART_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#f3f4f6"/><polyline points="20,140 90,110 160,120 230,60 300,30" fill="none" stroke="#2563eb" stroke-width="4"/><text x="20" y="24" font-family="sans-serif" font-size="14" fill="#374151">Permits per quarter</text></svg>',
  );

function claim(id: string, itemId: string, fields: Partial<ClaimRef>): ClaimRef {
  return {
    id,
    item_id: itemId,
    claim: fields.context_quote ?? "",
    context_quote: null,
    context_paragraph: null,
    image_urls: [],
    updated_quote: null,
    context_url: ITEMS.find((i) => i.id === itemId)!.url,
    start_seconds: null,
    end_seconds: null,
    ...fields,
  };
}

function note(id: string, fields: Partial<NoteRow> & { claim: ClaimRef }): NoteRow {
  return {
    id,
    claim_id: fields.claim.id,
    note: "",
    sources: [],
    has_source_details: false,
    helpful_count: 0,
    somewhat_helpful_count: 0,
    not_helpful_count: 0,
    author_id: null,
    author_name: null,
    improved_from_note_id: null,
    status: "published",
    created_at: daysAgo(1),
    ...fields,
  };
}

const RENT_CLAIM = claim("claim-rent", "item-1", {
  context_quote: "Rents in the city fell by 20% last year.",
  context_paragraph:
    "Everyone says the housing market is stuck, but the numbers tell a different story. Rents in the city fell by 20% last year. That is the largest drop since records began, and it happened while the population grew.",
  start_seconds: 10,
});

const PERMITS_CLAIM = claim("claim-permits", "item-1", {
  context_quote: null,
  claim: "Building permits tripled between the first and the last quarter of the year.",
  image_urls: [CHART_IMAGE],
  start_seconds: 40,
});

const GRID_CLAIM = claim("claim-grid", "item-2", {
  context_quote: "The grid cannot take more than 30% wind and solar.",
  context_paragraph:
    "Engineers have warned about this for years. The grid cannot take more than 30% wind and solar. Beyond that point, they say, blackouts become routine.",
});

const BATTERY_CLAIM = claim("claim-battery", "item-2", {
  context_quote: "Battery prices doubled over the decade.",
  updated_quote: "Battery prices halved over the decade.",
});

export const NOTES: NoteRow[] = [
  note("note-rent", {
    claim: RENT_CLAIM,
    note: "The city's own rent index shows a 2% fall last year, not 20%. The 20% figure is the drop in new listings, which is a different measure.",
    sources: [
      { url: "https://housing.example.gov/rent-index-2025", sort_order: 0 },
      { url: "https://news.example.org/listings-report", sort_order: 1 },
    ],
    has_source_details: true,
    helpful_count: 6,
    somewhat_helpful_count: 1,
  }),
  note("note-rent-improved", {
    claim: RENT_CLAIM,
    note: "Rents fell 2% last year according to the city's rent index (page 4). New listings fell 20%, which is likely where the figure comes from.",
    sources: [{ url: "https://housing.example.gov/rent-index-2025", sort_order: 0 }],
    author_id: "user-maria",
    author_name: "maria",
    improved_from_note_id: "note-rent",
    helpful_count: 1,
    created_at: daysAgo(0.5),
  }),
  note("note-permits", {
    claim: PERMITS_CLAIM,
    note: "The chart's axis starts at 400, not at zero. Permits rose from 480 to 610, an increase of about 27%.",
    sources: [{ url: "https://stats.example.gov/building-permits", sort_order: 0 }],
    helpful_count: 1,
  }),
  note("note-grid", {
    claim: GRID_CLAIM,
    note: "Several grids already run above 30% wind and solar for the whole year without routine blackouts.",
    sources: [{ url: "https://energy.example.org/grid-share-2025", sort_order: 0 }],
    not_helpful_count: 3,
    created_at: daysAgo(8),
  }),
  note("note-battery", {
    claim: BATTERY_CLAIM,
    note: "Battery pack prices fell by about half over the decade, they did not double.",
    sources: [{ url: "https://energy.example.org/battery-prices", sort_order: 0 }],
    helpful_count: 4,
    created_at: daysAgo(8),
  }),
];

export const NNN_ENTRIES: NnnRow[] = [
  {
    id: "nnn-1",
    claim_id: RENT_CLAIM.id,
    author_id: "user-sam",
    author_name: "sam",
    body: "The post links to the listings report two paragraphs later, so readers can see what the number means.",
    helpful_count: 1,
    somewhat_helpful_count: 0,
    not_helpful_count: 2,
    status: "published",
    created_at: daysAgo(0.2),
  },
];

export const NOTE_SET = noteSetOf(NOTES, NNN_ENTRIES);

export const noteById = (id: string) => NOTES.find((n) => n.id === id)!;

/** A seed for the query cache: one cached answer under one key. */
export type QuerySeed = readonly [readonly unknown[], unknown];

/** Everything the website's feed of the fixture project reads. */
export const FEED_SEEDS: QuerySeed[] = [
  [queryKeys.projects, PROJECTS],
  [queryKeys.projectItems(PROJECT.id), ITEMS],
  [queryKeys.projectNoteSet(PROJECT.id), NOTE_SET],
  [queryKeys.sourceDetails("note-rent"), [
    { url: "https://housing.example.gov/rent-index-2025", quote: "Average rents declined by 2.1% compared with the previous year.", explanation: "The city's official index, which measures rents paid.", sort_order: 0 },
  ]],
];

/** A signed-in reader, for components that show the reader's name. Only the
 *  fields those components read are filled in. */
export const SESSION = {
  access_token: "",
  refresh_token: "",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "user-reader", email: "reader@example.com", user_metadata: { user_name: "reader" }, app_metadata: {}, aud: "authenticated", created_at: daysAgo(30), is_anonymous: false },
} as unknown as import("@supabase/supabase-js").Session;

/** The fixture post as the extension resolves it from the page address. */
export const PAGE_ITEM: PageItem = {
  ...ITEMS[0]!,
  source: "substack",
  status: "done",
  error: null,
  checked_scope: "page",
  full_text: null,
  projectSlug: PROJECT.slug,
};

/** Everything the extension's overlays read for the fixture post. */
export const PAGE_SEEDS: QuerySeed[] = [
  [queryKeys.itemNoteSet(PAGE_ITEM.id), noteSetOf(NOTES.filter((n) => n.claim.item_id === PAGE_ITEM.id), NNN_ENTRIES)],
  ...FEED_SEEDS.filter(([key]) => key[0] === "sourceDetails"),
];

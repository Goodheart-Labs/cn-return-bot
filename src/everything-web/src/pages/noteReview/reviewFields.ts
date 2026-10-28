import { LARGE_COUNTS, SMALL_COUNTS, type FieldDef, type FieldOption, type FieldQuery } from "@cn/core/fieldQuery";

/* What the review page filters, sorts and shows by. Each field's id is a
 * column of the database's field row (everything_review_field_row, migration
 * 153), so a new field is one entry here and one column there. The fields are
 * listed in the order the Filter and Sort menus show them, with what Nathan
 * needs most for posting on X first. */

const YES_NO: FieldOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

const VOTES: FieldOption[] = [
  { value: "helpful", label: "Helpful" },
  { value: "somewhat", label: "Somewhat helpful" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "none", label: "Not voted yet" },
];

/** Note length thresholds, in characters. A tweet holds 280. */
const NOTE_LENGTHS = [100, 150, 200, 280, 400, 600];

export const REVIEW_FIELDS: FieldDef[] = [
  {
    id: "on_x",
    label: "Posted on X",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "not_posted", label: "Not posted yet" },
      { value: "posted", label: "Posted on X" },
      { value: "wont_post", label: "We won't post it" },
    ],
  },
  { id: "my_vote", label: "My vote", kind: "choice", multiple: true, sortable: false, options: VOTES },
  {
    id: "rating",
    label: "Overall rating",
    hint: "How the crowd's votes rate the note. The author's own automatic vote does not count.",
    kind: "choice",
    multiple: true,
    sortable: true,
    options: [
      { value: "helpful", label: "Rated helpful", hint: "Notes the crowd's votes rate helpful" },
      { value: "upvoted", label: "Only upvotes", hint: "Helpful or Somewhat helpful votes and no Not helpful vote" },
      { value: "other", label: "Everything else", hint: "Every other note, including notes nobody voted on" },
      { value: "downvoted", label: "Only downvotes", hint: "Not helpful votes and no Helpful or Somewhat helpful vote" },
      { value: "not_helpful", label: "Rated not helpful", hint: "Notes the crowd's votes rate not helpful" },
    ],
  },
  { id: "p_helpful", label: "P(helpful)", hint: "The note judge's guess of the chance that the note ends up rated helpful", kind: "percent", sortable: true },
  { id: "p_impactful", label: "P(impactful)", hint: "The note judge's guess of the chance that the note makes our leaderboard", kind: "percent", sortable: true },
  { id: "helpful_votes", label: "Helpful votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  { id: "not_helpful_votes", label: "Not helpful votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  { id: "somewhat_votes", label: "Somewhat helpful votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  { id: "votes", label: "All votes", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  {
    id: "views",
    label: "Views",
    hint: "Readers outside our team who were shown the notes on this post",
    kind: "count",
    thresholds: LARGE_COUNTS,
    bound: "atLeast",
    offerNone: true,
    sortable: true,
  },
  {
    id: "creator_views",
    group: "Creator",
    label: "Average views per post",
    hint: "The average views of the creator's posts that anybody saw",
    kind: "count",
    thresholds: LARGE_COUNTS,
    bound: "atLeast",
    sortable: true,
  },
  { id: "creator_posts", group: "Creator", label: "Posts with views", hint: "How many of the creator's posts anybody saw", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", sortable: true },
  { id: "creator", group: "Creator", label: "Specific creators", kind: "choice", multiple: true, sortable: false, labelColumn: "creator_name" },
  { id: "written", label: "Written", hint: "When Claude wrote the note", kind: "date", sortable: true },
  { id: "published", label: "Post published", kind: "date", sortable: true },
  {
    id: "approval",
    label: "Approval",
    hint: "Approved: Jim or Nathan voted Helpful and neither voted Not helpful. Disapproved: the other way round. Without such a vote, a note the crowd rated helpful counts as approved and one it rated not helpful as disapproved. Everything else is not reviewed.",
    kind: "choice",
    multiple: true,
    sortable: true,
    options: [
      { value: "approved", label: "Approved" },
      { value: "not_reviewed", label: "Not reviewed", hint: "Includes notes Jim and Nathan disagree on" },
      { value: "disapproved", label: "Disapproved" },
    ],
  },
  { id: "jim_vote", group: "Jim and Nathan", label: "Jim's vote", kind: "choice", multiple: true, sortable: false, options: VOTES },
  { id: "nathan_vote", group: "Jim and Nathan", label: "Nathan's vote", kind: "choice", multiple: true, sortable: false, options: VOTES },
  {
    id: "outcome",
    label: "Note or no note",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "note", label: "A note" },
      { value: "no_note_needed", label: "No note needed" },
      { value: "too_hard", label: "Too hard to source" },
      { value: "withdrawn", label: "Withdrawn by Claude" },
    ],
  },
  {
    id: "kind",
    label: "Kind of note",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "wrong_or_misleading", label: "Wrong or misleading" },
      { value: "missing_context", label: "Missing context" },
      { value: "small_mistake", label: "Small mistake" },
    ],
  },
  {
    id: "on_site",
    label: "On the site",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "on_site", label: "On the site" },
      { value: "not_yet", label: "Saved, not on the site yet" },
      { value: "deleted", label: "Deleted from the site" },
    ],
  },
  {
    id: "posted_as",
    label: "Posted as",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "ai", label: "An AI note" },
      { value: "jim", label: "Jim" },
      { value: "nathan", label: "Nathan" },
    ],
  },
  { id: "leaderboard", label: "On our leaderboard", kind: "choice", multiple: false, sortable: false, options: YES_NO },
  { id: "few_shot", label: "Few-shot example", hint: "Notes we picked to show the note writer as examples", kind: "choice", multiple: false, sortable: false, options: YES_NO },
  { id: "skipped", label: "Skipped by me", kind: "choice", multiple: false, sortable: false, options: YES_NO },
  {
    id: "chat",
    label: "Chat with Claude",
    kind: "choice",
    multiple: true,
    sortable: false,
    options: [
      { value: "none", label: "No chat" },
      { value: "waiting", label: "Waiting for Claude" },
      { value: "answered", label: "Claude answered" },
    ],
  },
  { id: "review_note", label: "Our review note", kind: "choice", multiple: false, sortable: false, options: YES_NO },
  { id: "note_length", label: "Note length", hint: "In characters. A tweet holds 280.", kind: "count", thresholds: NOTE_LENGTHS, bound: "atMost", sortable: true },
  { id: "sources", label: "Sources", hint: "How many different pages the note cites", kind: "count", thresholds: SMALL_COUNTS, bound: "atLeast", sortable: true },
];

/** The buttons a card can show, each switched on or off in the Display menu. */
export const DISPLAY = {
  postOnX: { value: "post_on_x", label: "Post on X", hint: "Opens the tweet and sends it to Typefully. Only in the local posting tool." },
  markPosted: { value: "mark_posted", label: "Posted on X", hint: "Marks a note that was posted on X without the posting tool" },
  wontPost: { value: "wont_post", label: "We won't post this" },
  chat: { value: "chat", label: "Chat with Claude" },
  improve: { value: "improve", label: "Improve the note" },
  skip: { value: "skip", label: "Skip" },
  fewShot: { value: "few_shot", label: "Few-shot example" },
  leaderboard: { value: "leaderboard", label: "Add to leaderboard" },
  delete: { value: "delete", label: "Delete from the site" },
} satisfies Record<string, FieldOption>;

export type DisplayOption = (typeof DISPLAY)[keyof typeof DISPLAY]["value"];

/** Not posted notes first, the crowd's best rated first, then by helpful
 *  votes, the creator's readers and the judge's two guesses. */
export const DEFAULT_REVIEW_QUERY: FieldQuery = {
  filters: [
    { field: "on_x", values: ["not_posted"] },
    { field: "outcome", values: ["note"] },
  ],
  sorts: ["rating", "helpful_votes", "creator_views", "p_helpful", "p_impactful"].map((field) => ({ field, descending: true })),
  display: [DISPLAY.postOnX, DISPLAY.markPosted, DISPLAY.wontPost, DISPLAY.chat, DISPLAY.improve, DISPLAY.delete].map((option) => option.value),
};

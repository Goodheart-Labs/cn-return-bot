# Common Notes data

Common Notes (https://commonnotes.net) writes Community Notes style notes on
YouTube videos, Substack posts, LessWrong / Alignment Forum / EA Forum posts and
other web pages. Most notes are written by AI note writers. Readers rate them
on the website and in the browser extension, and can write notes of their own.

The files follow the layout of X's public Community Notes download
(https://communitynotes.x.com/guide/en/under-the-hood/download-data) as closely
as our data allows: the same file names, the same columns in the same order, and
the same values. Columns that have no counterpart in Common Notes are kept but
left empty or set to 0, so code written for X's files can read these too. Each
file adds a few Common Notes columns at the end. X's files leave out the posts
the notes are on. Here they are included (`items`, `claims`), because a note
makes little sense without the text it is on.

Please use the data for research and do not republish the post texts: many of
them belong to their authors and some come from paid subscriptions.

## Reading the files

All files are tab-separated with a header line, encoded as UTF-8. A field that
contains a tab, a line break or a double quote is wrapped in double quotes, with
its own double quotes doubled. `pandas.read_csv(path, sep="\t")` reads every file
as is. Empty fields mean "no value". Timestamps ending in `Millis` are
milliseconds since 1970-01-01 UTC, as in X's files.

Ids are UUID strings, not numbers as on X. A note can be opened on the website at
`https://commonnotes.net/notes?note=<noteId>`.

Participant ids (`noteAuthorParticipantId`, `raterParticipantId`,
`participantId`) are SHA-256 hashes, like X's. They are stable within this export,
so one person's ratings can be followed across notes. They are salted with a
random value that was thrown away after the export, so they cannot be matched to
accounts or to the ids of another export.

## How the parts fit together

```
items  ──<  claims  ──<  notes  ──<  ratings
 (post)     (passage)     (note)      (one rating per rater and note)
                            │
                            ├──<  noteSources
                            └──   noteStatusHistory (one row per note)
```

An **item** is one post, video or page. The AI note writers read an item and cut
it into **claims**: factual statements, each with the passage it comes from.
Notes are written on a claim, so a note always refers to one passage of one item.
This is the main difference from X, where a note is on a whole tweet.

## notes-00000.tsv

One row per note. Besides ordinary notes this holds "note not needed" entries:
a reader's explanation of why a passage needs no note. X stores those as notes
with the classification `NOT_MISLEADING`, and so does this file.

| Column | Meaning |
|---|---|
| noteId | The note's id. |
| noteAuthorParticipantId | Hashed id of the author. Every note by the same AI note writer shares one id (see `userEnrollment`). |
| createdAtMillis | When the note was written. |
| itemId | The item the note is on. X's column at this position is `tweetId`. |
| classification | `MISINFORMED_OR_POTENTIALLY_MISLEADING` for a note, `NOT_MISLEADING` for a "note not needed" entry. |
| believable, harmful, validationDifficulty | Always empty. X no longer fills them either. |
| misleading… (7 columns) | Always 0. Common Notes does not ask writers for these tags. Empty on `NOT_MISLEADING` rows, as on X. |
| notMisleading… (5 columns) | Always 0 on `NOT_MISLEADING` rows, empty otherwise. |
| trustworthySources | 1 if the note cites at least one source. |
| summary | The note's text. |
| isMediaNote, isCollaborativeNote | Always 0. |
| claimId | *Common Notes.* The claim (passage) the note is on. |
| writtenBy | *Common Notes.* `claude_code`: written by Claude Opus running in Claude Code, which researches each post with subagents and checks every source quote. `pipeline`: written by our automated fact-checking pipeline (search, writer and checking steps on several LLMs). `human`: written by a reader. |
| improvedFromNoteId | *Common Notes.* When a reader or reviewer wrote a better version of an existing note, the note it improves on. |

## ratings-00000.tsv

One row per rater and note, with the rater's current rating.

| Column | Meaning |
|---|---|
| noteId | The rated note. |
| raterParticipantId | Hashed id of the rater. |
| createdAtMillis | When the rating was first given. |
| version | Always 2, X's value for ratings with a `helpfulnessLevel`. |
| agree, disagree, helpful, notHelpful | Always 0. These are X's legacy columns. |
| helpfulnessLevel | `HELPFUL`, `SOMEWHAT_HELPFUL` or `NOT_HELPFUL`. |
| helpful… (9 columns), notHelpful… (13 columns) | Always 0. Common Notes does not ask raters for reasons. |
| ratedOnItemId | The item the note is on. X's column is `ratedOnTweetId`. |
| ratingSourceBucketed | Always `DEFAULT`. Common Notes does not sample raters. |
| suggestion, suggestionId | Always empty. |
| updatedAtMillis | *Common Notes.* When the rating was last changed. Empty for "note not needed" entries and for ratings never changed since that was recorded. |
| platform | *Common Notes.* Where the rating was given: `web` (the website) or `extension` (the browser extension, inline on the post). Empty when unknown. |

Things that differ from X:

- When someone writes a note, the website automatically records a `HELPFUL`
  rating from them on their own note. Those ratings are in this file, so a rater
  id can equal the note's author id. The status rule below ignores that vote.
- Readers need no account to rate. Their first rating silently creates an
  anonymous account tied to their browser, so one person on two browsers counts as
  two raters.
- Members of the Common Notes team rate many notes. Their ratings are marked
  through `userEnrollment.participantType = team`.

## noteStatusHistory-00000.tsv

One row per note with its current status and when it changed.

Common Notes does not run X's matrix factorization. A note's status comes from
its rating counts alone. We treat each rating as a draw from the share θ of all
raters who would call the note helpful, with a Beta(1.68, 3.32) prior on θ. A
`SOMEWHAT_HELPFUL` rating counts as half a helpful rating and nothing on the other
side. `pHelpful` is the posterior probability that θ is above 0.4. A note is
`CURRENTLY_RATED_HELPFUL` once `pHelpful` reaches 0.78 and
`CURRENTLY_RATED_NOT_HELPFUL` once it falls to 0.2 or below; otherwise it is
`NEEDS_MORE_RATINGS`. In practice two helpful ratings and one somewhat helpful
rating make a note helpful, and two not helpful ratings make it not helpful.

The status times come from replaying the ratings in time order. Rating changes
and retractions are recorded only since 2026-10-06. Before that, only each
rating's first time and its current value are known, so a few early status changes
may be missing.

| Column | Meaning |
|---|---|
| noteId, noteAuthorParticipantId, createdAtMillis | As in `notes`. |
| timestampMillisOfFirstNonNMRStatus, firstNonNMRStatus | When the note first left `NEEDS_MORE_RATINGS`, and to which status. |
| timestampMillisOfCurrentStatus, currentStatus | The current status and when the note got it. The creation time if it never changed. |
| timestampMillisOfLatestNonNMRStatus, mostRecentNonNMRStatus | The most recent status other than `NEEDS_MORE_RATINGS`, and when it began. |
| timestampMillisOfStatusLock, lockedStatus, timestampMillisOfRetroLock | Always empty. Statuses never lock on Common Notes. |
| currentCoreStatus, currentExpansionStatus, currentGroupStatus, currentModelingGroup, currentMultiGroupStatus, currentModelingMultiGroup | Always empty. These belong to X's models. |
| currentDecidedBy | Always `CommonNotesBetaRule`, the rule above. |
| timestampMillisOfMostRecentStatusChange | When the status last changed. Empty if it never did. |
| timestampMillisOfNmrDueToMinStableCrhTime, timestampMillisOfFirstNmrDueToMinStableCrhTime, timestampMillisAbovePcrhThreshold | Always empty. |
| timestampMinuteOfFinalScoringOutput | The minute this export was made, in minutes since 1970. |
| pHelpful | *Common Notes.* The note's current `pHelpful`. |

## userEnrollment-00000.tsv

One row per participant who wrote or rated a note. Common Notes has no
earn-in: anyone can rate and write from the start. So every participant is
`earnedIn`, from the moment of their first note or rating.

| Column | Meaning |
|---|---|
| participantId | Hashed id, as used in the other files. |
| enrollmentState | Always `earnedIn`. |
| successfulRatingNeededToEarnIn | Always 0. |
| timestampOfLastStateChange | The participant's first note or rating, in milliseconds. |
| timestampOfLastEarnOut, modelingPopulation, modelingGroup | Always empty. |
| numberOfTimesEarnedOut | Always 0. |
| participantType | *Common Notes.* `reader`, `team` (a member of the Common Notes team), `ai_claude_code` or `ai_pipeline` (the two AI note writers, see `notes.writtenBy`). |

## noteSources-00000.tsv

*Common Notes only.* The sources a note cites, one row per source. Early notes
and many reader notes put their links in the note text instead.

| Column | Meaning |
|---|---|
| noteId | The note. |
| sortOrder | The source's position in the note's list. |
| url | The source. Tracking parameters are removed. |
| quote | The passage of the source that supports the note, where the writer gave one. |
| explanation | What the source shows, where the writer gave one. |

## items-00000.tsv

*Common Notes only.* The posts, videos and pages the notes are on. It holds every
item with at least one note, and every item our note writers read in full even if
they found nothing to note.

| Column | Meaning |
|---|---|
| itemId | The item's id. |
| source | `youtube`, `substack`, `lesswrong` (LessWrong, the Alignment Forum or the EA Forum), `podcast` or `web` (any other page). |
| url | The item's address. Tracking parameters are removed. |
| title | The title. |
| creatorName | The creator the item belongs to: a channel, a publication or a forum author. `Around the web` collects one-off pages. |
| creatorFeedUrl | The creator's channel, publication or profile address. |
| publishedDate | The day it was published, where known. |
| publishedAtMillis | The exact publication time, where known. |
| firstCheckedAtMillis | When a note writer first finished reading the whole item. Empty if it was never read in full, for example when a reader wrote a note on it directly. |
| checkedScope | `page` if the item was read in full, `paragraph` if only one passage was checked, empty if only readers wrote on it. |
| skipReason | Why the item got no fact-check, for example `no captions` for a video without captions, or the AI's reason for finding that the text does not try to shape beliefs. |
| text | The full text the note writers read. For videos it is the transcript. |

## claims-00000.tsv

*Common Notes only.* Every claim found in the items above, including the many
that got no note. This shows which statements were checked and which passed.

| Column | Meaning |
|---|---|
| claimId | The claim's id. |
| itemId | The item it is from. |
| createdAtMillis | When it was found. |
| origin | Who found it: `pipeline` (the automated pipeline, which lists every factual statement), `claude_code` (the Claude note writer, which lists only passages it wrote a note on) or `reader` (a reader writing a note on a passage). |
| claim | The statement in neutral, self-contained words. |
| passage | The exact words in the item that the claim and its notes are on. |
| contextParagraph | The paragraph around the passage. |
| startSeconds, endSeconds | For videos, where the passage is spoken. |
| imageUrls | A JSON list of images the claim rests on, if any. |
| aiRating | For pipeline claims: how likely the pipeline's first model judged the claim to be true, on the scale `certainly true`, `likely true`, `somewhat likely true`, `uncertain`, `somewhat likely false`, `likely false`, `certainly false`. Only claims rated `uncertain` or worse were fact-checked. |
| checkStatus | `note` (got a note), `no_note` (checked, no note needed), `skipped` (not checked, usually because it was rated likely true) or `error` (the check failed). |

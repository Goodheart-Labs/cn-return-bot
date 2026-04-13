# Community Notes Public Data Schema

Reference for X's publicly downloadable Community Notes data. Source: https://communitynotes.x.com/guide/en/under-the-hood/download-data

## Data files

| File | Join key | Description |
|------|----------|-------------|
| Notes | noteId | All notes with author, tweet, classification, and text |
| Ratings | noteId | All ratings with helpfulness level and tag checkboxes |
| Note Status History | noteId | Scoring metadata: statuses, timestamps, which model decided |
| User Enrollment | participantId | Enrollment state, modeling population/group |
| Note Requests | tweetId | Posts eligible for notes (in-product + API feeds) |

Snapshots are cumulative TSV files released daily (48h delay). Deleted notes/ratings are removed from future snapshots but Note Status History retains metadata.

## Key status fields (Note Status History)

| Field | Description |
|-------|-------------|
| `currentStatus` | **Overall status** of the note. Always one of: `NEEDS_MORE_RATINGS`, `CURRENTLY_RATED_HELPFUL`, `CURRENTLY_RATED_NOT_HELPFUL` |
| `currentCoreStatus` | Status from core submodel only. **Can be empty** if the note wasn't scored by core. |
| `currentExpansionStatus` | Status from expansion submodel. Can be empty. |
| `currentGroupStatus` | Status from group submodel. Can be empty. |
| `currentDecidedByKey` | Which submodel determined `currentStatus` (e.g. `CoreModel (v1.1)`, `ExpansionModel (v1.1)`, `GroupModel01 (v1.1)`) |

**Always use `currentStatus` to determine if a note is helpful.** `currentCoreStatus` will miss notes rated helpful by expansion or group models.

## Notes table

| Field | Type | Description |
|-------|------|-------------|
| noteId | Long | Unique note ID |
| participantId | String | Stable author ID (not username) |
| createdAtMillis | Long | Creation time (epoch ms UTC) |
| tweetId | Long | Tweet the note is about |
| classification | String | `NOT_MISLEADING` or `MISINFORMED_OR_POTENTIALLY_MISLEADING` |
| summary | String | Note text |
| isMediaNote | Int | 1 if note is about media (shown on all tweets with that media) |
| isCollaborativeNote | Int | 1 if collaborative note (new 2026-02-04) |

## Note Status History table

| Field | Type | Description |
|-------|------|-------------|
| noteId | Long | Unique note ID |
| participantId | String | Author ID |
| createdAtMillis | Long | Creation time (epoch ms UTC) |
| currentStatus | String | Overall current status |
| currentCoreStatus | String | Core submodel status (can be empty) |
| currentExpansionStatus | String | Expansion submodel status (can be empty) |
| currentGroupStatus | String | Group submodel status (can be empty) |
| currentMultiGroupStatus | String | Multi-group submodel status (can be empty) |
| currentDecidedByKey | String | Which submodel determined overall status |
| currentModelingGroup | Int | Group model ID (0 = none) |
| firstNonNMRStatus | String | First status besides NMR (empty if never left NMR) |
| timestampMillisOfFirstNonNMRStatus | Long | When first non-NMR status was assigned |
| timestampMillisOfCurrentStatus | Long | When current status was assigned |
| timestampMillisOfMostRecentStatusChange | Long | Last status change (-1 if never changed) |
| lockedStatus | String | Locked status (empty if unlocked) |
| timestampMillisOfStatusLock | Long | When status was locked |

## Ratings table

| Field | Type | Description |
|-------|------|-------------|
| noteId | Long | Note being rated |
| participantId | String | Rater ID |
| createdAtMillis | Long | Rating time (epoch ms UTC) |
| helpfulnessLevel | String | `NOT_HELPFUL`, `SOMEWHAT_HELPFUL`, `HELPFUL` |
| agree / disagree | Int | Binary: agrees with note's conclusion |
| ratingSourceBucketed | String | `DEFAULT` or `POPULATION_SAMPLED` |

Plus various `helpful*` and `notHelpful*` checkbox fields for detailed feedback tags.

## User Enrollment table

| Field | Type | Description |
|-------|------|-------------|
| participantId | String | User ID |
| enrollmentState | String | `newUser`, `earnedIn`, `atRisk`, `earnedOutNoAcknowledge`, `earnedOutAcknowledge`, `apiEarnedIn` |
| modelingPopulation | String | `CORE` or `EXPANSION` |
| modelingGroup | Int | Group model ID (0-13) |

## Note Requests table

| Field | Type | Description |
|-------|------|-------------|
| tweetId | Long | Post with note request |
| sourceLinks | Array | Optional X post URLs from requestors |
| noteRequestFeedEligibleTimestamp | Long | When eligible for in-app feed (-1 if never) |
| apiSmallFeedEligibleTimestamp | Long | When eligible for API small feed (-1 if never) |
| apiLargeFeedEligibleTimestamp | Long | When eligible for API large feed (-1 if never) |
| apiXlFeedEligibleTimestamp | Long | When eligible for API XL feed (-1 if never) |

# X API — Search for Community Notes Written

`GET /2/notes/search/notes_written` — returns all Community Notes written by
the authenticated user.

- **Source:** https://docs.x.com/x-api/community-notes/search-for-community-notes-written
- **Doc index:** https://docs.x.com/llms.txt
- **Operation ID:** `searchCommunityNotesWritten`
- **Server:** `https://api.x.com`
- **Auth:** `OAuth2UserToken` with `tweet.read` scope **or** `UserToken` (HTTP OAuth)

## Query parameters

| Name | Type | Required | Notes |
|---|---|:-:|---|
| `test_mode` | `boolean` | yes | `true` returns notes written for the test; `false` returns product notes. |
| `pagination_token` | `string` | no | Pagination token from a prior response's `meta.next_token`. |
| `max_results` | `integer` 1–100 (default `10`) | no | |
| `note.fields` | comma-separated array | no | Subset of `id`, `info`, `scoring_status`, `status`, `test_result`. Only the fields listed are returned. |

## Response — 200

```yaml
type: object
properties:
  data:
    type: array
    minItems: 1
    items:
      $ref: '#/components/schemas/Note'
  errors:
    type: array
    minItems: 1
    items:
      $ref: '#/components/schemas/Problem'   # RFC 7807 problem details
  meta:
    type: object
    properties:
      next_token:
        type: string
        minLength: 1
      result_count:
        type: integer
        format: int32
```

The response also surfaces the standard `default` error response with either
`application/json` (`Error`) or `application/problem+json` (`Problem`).

## Schemas

### `Note`

> A X Community Note on a Post.

```yaml
type: object
required: [id, post_id, note_info]
properties:
  id:              $ref NoteId
  info:            $ref NoteInfo
  post_id:         $ref TweetId
  scoring_status:  $ref NoteScoringStatus
  status:          $ref NoteRatingStatus
  test_result:     $ref NoteTestResult
```

### `NoteId`

```yaml
type: string
description: The unique identifier of this Community Note.
pattern: ^[0-9]{1,19}$
example: "1146654567674912769"
```

### `TweetId`

```yaml
type: string
description: >
  Unique identifier of this Tweet. Returned as a string to avoid problems with
  languages and tools that can't handle large integers.
pattern: ^[0-9]{1,19}$
example: "1346889436626259968"
```

### `NoteInfo`

```yaml
type: object
required: [text, classification, misleading_tags, trustworthy_sources]
additionalProperties: false
properties:
  classification:
    $ref: '#/components/schemas/NoteClassification'
  is_media_note:
    type: boolean
    description: Whether the note is a media note.
  misleading_tags:
    type: array
    items:
      $ref: '#/components/schemas/MisleadingTags'
  text:
    type: string
    description: The text summary in the Community Note.
    pattern: ^(?=[\s\S]*https?://\S+)[\s\S]+$
  trustworthy_sources:
    type: boolean
    description: Whether the note provided trustworthy links.
```

### `NoteClassification`

```yaml
type: string
description: Community Note classification type.
enum:
  - misinformed_or_potentially_misleading
  - not_misleading
```

### `MisleadingTags`

```yaml
type: string
description: Community Note misleading-tag type.
enum:
  - disputed_claim_as_fact
  - factual_error
  - manipulated_media
  - misinterpreted_satire
  - missing_important_context
  - other
  - outdated_information
```

### `NoteRatingStatus`

```yaml
type: string
description: Community Note rating status.
enum:
  - currently_rated_helpful
  - currently_rated_not_helpful
  - firm_reject
  - insufficient_consensus
  - minimum_ratings_not_met
  - needs_more_ratings
  - needs_your_help
```

### `NoteScoringStatus`

> The scoring status of a Community Note.

```yaml
type: object
properties:
  has_access:
    type: boolean
    description: Whether the user has access to the scoring status of the Community Note.
  rating_counts_per_model:
    type: object
    description: Rating count stats per model.
    properties:
      model_name:
        type: string
        description: The name of the model.
      value:
        $ref: '#/components/schemas/NoteRatingCountsPerModel'
```

### `NoteRatingCountsPerModel`

> The rating counts of a Community Note per model.

```yaml
type: object
properties:
  negative_factor_bucket_counts:
    $ref: '#/components/schemas/NoteFactorBucketCounts'
  neutral_factor_bucket_counts:
    $ref: '#/components/schemas/NoteFactorBucketCounts'
  positive_factor_bucket_counts:
    $ref: '#/components/schemas/NoteFactorBucketCounts'
```

### `NoteFactorBucketCounts`

> Rating counts for a rater factor bucket.

```yaml
type: object
properties:
  helpful_count:
    type: integer
    description: The count of helpful ratings.
  helpful_tag_counts:
    type: object
    description: Helpful tag counts.
    properties:
      tag_count:
        type: integer
        description: The count of the tag.
      tag_name:
        type: string
        description: The name of the tag.
  not_helpful_count:
    type: integer
    description: The count of not-helpful ratings.
  not_helpful_tag_counts:
    type: object
    description: Not-helpful tag counts.
    properties:
      tag_count:
        type: integer
        description: The count of the tag.
      tag_name:
        type: string
        description: The name of the tag.
  somewhat_helpful_count:
    type: integer
    description: The count of somewhat-helpful ratings.
```

> **Caveat on rating tag counts:** `helpful_tag_counts` and
> `not_helpful_tag_counts` are objects with a single `{tag_name, tag_count}`
> pair, **not arrays**. You get the *top* helpful tag and *top* not-helpful tag
> per rater factor bucket — not the full per-tag distribution.

### `NoteTestResult`

> The evaluation result of a community note.

```yaml
type: object
properties:
  evaluator_score_bucket:
    type: string
    description: Score bucket from the evaluator result.
  evaluator_type:
    type: string
    description: The type of the evaluator.
```

## Auth — relevant scopes

`OAuth2UserToken` with `tweet.read`:

> View all Posts you can see, including those from protected accounts.

(The OpenAPI spec lists every scope the OAuth2 flow supports, but `tweet.read`
is the only one this endpoint requires. `UserToken` (HTTP OAuth) also works
without scope selection.)

## Standard error envelopes

The endpoint inherits the X API's `Error` and `Problem` shapes:

```yaml
Error:
  type: object
  required: [code, message]
  properties:
    code:    { type: integer, format: int32 }
    message: { type: string }

Problem:
  type: object
  description: HTTP Problem Details (IETF RFC 7807).
  required: [type, title]
  properties:
    detail: { type: string }
    status: { type: integer }
    title:  { type: string }
    type:   { type: string }
  discriminator:
    propertyName: type
    mapping:
      about:blank:                                                   $ref GenericProblem
      https://api.twitter.com/2/problems/client-disconnected:        $ref ClientDisconnectedProblem
      https://api.twitter.com/2/problems/client-forbidden:           $ref ClientForbiddenProblem
      https://api.twitter.com/2/problems/conflict:                   $ref ConflictProblem
      https://api.twitter.com/2/problems/disallowed-resource:        $ref DisallowedResourceProblem
      https://api.twitter.com/2/problems/duplicate-rules:            $ref DuplicateRuleProblem
      https://api.twitter.com/2/problems/invalid-request:            $ref InvalidRequestProblem
      https://api.twitter.com/2/problems/invalid-rules:              $ref InvalidRuleProblem
      https://api.twitter.com/2/problems/noncompliant-rules:         $ref NonCompliantRulesProblem
      https://api.twitter.com/2/problems/not-authorized-for-field:   $ref FieldUnauthorizedProblem
      https://api.twitter.com/2/problems/not-authorized-for-resource: $ref ResourceUnauthorizedProblem
      https://api.twitter.com/2/problems/operational-disconnect:     $ref OperationalDisconnectProblem
      https://api.twitter.com/2/problems/resource-not-found:         $ref ResourceNotFoundProblem
      https://api.twitter.com/2/problems/resource-unavailable:       $ref ResourceUnavailableProblem
      https://api.twitter.com/2/problems/rule-cap:                   $ref RulesCapProblem
      https://api.twitter.com/2/problems/streaming-connection:       $ref ConnectionExceptionProblem
      https://api.twitter.com/2/problems/unsupported-authentication: $ref UnsupportedAuthenticationProblem
      https://api.twitter.com/2/problems/usage-capped:               $ref UsageCapExceededProblem
```

Most relevant for callers of this endpoint: `ClientForbiddenProblem` (caller
not enrolled / official-client-forbidden), `UnsupportedAuthenticationProblem`,
`UsageCapExceededProblem` (period: `Daily` | `Monthly`; scope: `Account` |
`Product`).

// Shared helpers for Community-Notes rating-reason tags (the keys of
// PublicDumpRatings.helpful_tag_counts / not_helpful_tag_counts).

// e.g. "notHelpfulSourcesMissingOrUnreliable" -> "Sources Missing Or Unreliable"
export function humanizeTagName(raw: string): string {
  const trimmed = raw.replace(/^helpful|^notHelpful/, "");
  return trimmed.replace(/([A-Z])/g, " $1").trim();
}

// Polarity is encoded in the tag prefix: notHelpful* reasons are tallied against
// not-helpful ratings, everything else (helpful*) against helpful ratings.
export function isNegativeRatingReason(reason: string): boolean {
  return reason.startsWith("notHelpful");
}

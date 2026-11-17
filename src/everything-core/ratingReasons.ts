// Helpers for the Community Notes rating-reason tags. Those tags are the keys of
// PublicDumpRatings.helpful_tag_counts and of not_helpful_tag_counts.

// Turns a raw tag such as "notHelpfulSourcesMissingOrUnreliable" into the
// readable "Sources Missing Or Unreliable".
export function humanizeTagName(raw: string): string {
  const trimmed = raw.replace(/^helpful|^notHelpful/, "");
  return trimmed.replace(/([A-Z])/g, " $1").trim();
}

// The tag's prefix carries its polarity. A tag starting with notHelpful is
// tallied against the not-helpful ratings. Every other tag starts with helpful
// and is tallied against the helpful ratings.
export function isNegativeRatingReason(reason: string): boolean {
  return reason.startsWith("notHelpful");
}

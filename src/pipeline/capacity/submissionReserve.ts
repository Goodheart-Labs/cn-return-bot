/** Migration 093 enforces the reserve across the cron and Signal processes. */
export type SubmissionLane = "automatic" | "signal";
export type SubmissionClaimOutcome = "submitted" | "rejected" | "uncertain";

export interface SubmissionCapacity {
  cap: number | null;
  used24h: number;
  inFlight: number;
  remaining: number | null;
  reserve: number;
}

/**
 * Avoid paying to generate automatic candidates when the reserve already binds.
 * This is only a read: the final atomic claim remains the submission authority.
 */
export async function automaticGenerationPreflight(
  logger: { getNoteSubmissionCapacity(): Promise<SubmissionCapacity> } | null,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!logger) return { allowed: false, reason: "Supabase is unavailable for the submission capacity check" };
  let capacity: SubmissionCapacity;
  try {
    capacity = await logger.getNoteSubmissionCapacity();
  } catch {
    return { allowed: false, reason: "submission capacity is unavailable; check migration 093 and database access" };
  }
  if (capacity.remaining === null) {
    return { allowed: false, reason: "the writing cap is unknown; automatic submissions preserve the Signal reserve" };
  }
  if (capacity.remaining <= capacity.reserve) {
    return { allowed: false, reason: `${capacity.remaining} estimated slot(s) remain, ${capacity.reserve} reserved for Signal` };
  }
  return { allowed: true };
}

export type SubmissionAdmission =
  | { status: "claimed"; claimId: string; capacity: SubmissionCapacity }
  | { status: "capacity_reserved"; reason: "reserve" | "capacity_exhausted" | "unknown_capacity"; capacity: SubmissionCapacity }
  | { status: "submission_busy"; reason: "claimed" | "submitted" | "uncertain"; capacity: SubmissionCapacity };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Treat a missing migration, malformed response or database failure as closed. */
export function parseSubmissionCapacity(value: unknown): SubmissionCapacity {
  const c = value as SubmissionCapacity | null;
  if (!c || !isCount(c.used24h) || !isCount(c.inFlight) || !isCount(c.reserve)
    || !(c.cap === null || isCount(c.cap)) || !(c.remaining === null || isCount(c.remaining))
    || (c.cap === null) !== (c.remaining === null)) {
    throw new Error("Invalid submission capacity response");
  }
  return c;
}

export function parseSubmissionAdmission(value: unknown): SubmissionAdmission {
  const result = value as SubmissionAdmission | null;
  if (!result) throw new Error("Missing submission admission response");
  parseSubmissionCapacity(result.capacity);
  if (result.status === "claimed" && typeof result.claimId === "string" && result.claimId.length > 0) return result;
  if (result.status === "capacity_reserved" && ["reserve", "capacity_exhausted", "unknown_capacity"].includes(result.reason)) return result;
  if (result.status === "submission_busy" && ["claimed", "submitted", "uncertain"].includes(result.reason)) return result;
  throw new Error("Invalid submission admission response");
}

/** Timeouts, transport failures and server errors may hide an accepted POST. */
export function isUncertainSubmissionError(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status !== "number" || status < 400 || status >= 500 || status === 408;
}

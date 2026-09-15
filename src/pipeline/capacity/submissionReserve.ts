/** Shared admission for scheduled and approved Signal submissions. */
export type SubmissionLane = "automatic" | "signal";
export type SubmissionClaimOutcome = "submitted" | "rejected" | "uncertain";

export interface SubmissionCapacity {
  cap: number | null;
  used24h: number;
  inFlight: number;
  remaining: number | null;
  reserve: number;
  canSubmit: boolean;
  probe: boolean;
  signalQueued: number;
  nextAttemptAt: string | null;
}

/**
 * Avoid generating automatic candidates while X is full or Signal is waiting.
 * This is only a read: the final atomic claim remains the submission authority.
 */
export async function automaticGenerationPreflight(
  logger: { getNoteSubmissionCapacity(): Promise<SubmissionCapacity> } | null,
): Promise<{ allowed: true; capacity: SubmissionCapacity } | { allowed: false; reason: string }> {
  if (!logger) return { allowed: false, reason: "Supabase is unavailable for the submission capacity check" };
  let capacity: SubmissionCapacity;
  try {
    capacity = await logger.getNoteSubmissionCapacity();
  } catch {
    return { allowed: false, reason: "submission capacity is unavailable; check migration 100 and database access" };
  }
  if (capacity.signalQueued > 0) {
    return { allowed: false, reason: `${capacity.signalQueued} approved Signal note(s) have submission priority` };
  }
  if (!capacity.canSubmit) {
    return { allowed: false, reason: capacity.nextAttemptAt
      ? `X writing limit reached; next attempt at ${capacity.nextAttemptAt}`
      : "waiting for the current submission to finish" };
  }
  return { allowed: true, capacity };
}

export type SubmissionAdmission =
  | { status: "claimed"; claimId: string; capacity: SubmissionCapacity }
  | { status: "capacity_reserved"; reason: "signal_priority" | "capacity_exhausted" | "probe_in_flight"; capacity: SubmissionCapacity }
  | { status: "submission_busy"; reason: "claimed" | "submitted" | "uncertain"; capacity: SubmissionCapacity };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Treat a missing migration, malformed response or database failure as closed. */
export function parseSubmissionCapacity(value: unknown): SubmissionCapacity {
  const c = value as SubmissionCapacity | null;
  if (!c || !isCount(c.used24h) || !isCount(c.inFlight) || !isCount(c.reserve)
    || !(c.cap === null || isCount(c.cap)) || !(c.remaining === null || isCount(c.remaining))
    || (c.cap === null) !== (c.remaining === null)
    || c.reserve !== 0 || !isCount(c.signalQueued)
    || typeof c.canSubmit !== "boolean" || typeof c.probe !== "boolean"
    || !(c.nextAttemptAt === null || (typeof c.nextAttemptAt === "string" && Number.isFinite(Date.parse(c.nextAttemptAt))))) {
    throw new Error("Invalid submission capacity response");
  }
  return c;
}

export function parseSubmissionAdmission(value: unknown): SubmissionAdmission {
  const result = value as SubmissionAdmission | null;
  if (!result) throw new Error("Missing submission admission response");
  parseSubmissionCapacity(result.capacity);
  if (result.status === "claimed" && typeof result.claimId === "string" && result.claimId.length > 0) return result;
  if (result.status === "capacity_reserved" && ["signal_priority", "capacity_exhausted", "probe_in_flight"].includes(result.reason)) return result;
  if (result.status === "submission_busy" && ["claimed", "submitted", "uncertain"].includes(result.reason)) return result;
  throw new Error("Invalid submission admission response");
}

/** Timeouts, transport failures and server errors may hide an accepted POST. */
export function isUncertainSubmissionError(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status !== "number" || status < 400 || status >= 500 || status === 408;
}

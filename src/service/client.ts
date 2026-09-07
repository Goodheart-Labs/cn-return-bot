/**
 * How a caller talks to the two services.
 *
 * A caller finds work, asks a service about it, and writes the answer into our
 * tables. This module is only the asking. Everything about our schema stays in
 * the caller, and everything about models and searching stays in the service.
 */

import {
  CHECK_CLAIM_PATH,
  EXTRACT_CLAIMS_PATH,
  HEALTH_PATH,
  SERVICE_AUTH_HEADER,
  type CheckClaimRequest,
  type CheckClaimResponse,
  type ExtractClaimsRequest,
  type ExtractClaimsResponse,
  type HealthResponse,
  type ServiceErrorResponse,
} from "./contract";

/** How long a caller waits for an answer. A check takes about a minute and a
 *  half of its own, and it may queue behind other work first, so this is a
 *  ceiling for a service that has stopped rather than a normal wait. */
const DEFAULT_CALL_TIMEOUT_MS = 30 * 60_000;

/** A scheduled caller fails rather than adding to a queue this far behind. An
 *  hour is well past anything healthy on either measure: a claim check takes
 *  about a minute and a half, so neither a waiting call nor an in-flight one
 *  ever legitimately reaches this age. The in-flight age matters because the
 *  most likely wedge is every slot stuck on a network request that never
 *  returns, and in that state nothing is waiting at all. */
export const QUEUE_STUCK_AFTER_SECONDS = 60 * 60;

export function queueIsStuck(health: HealthResponse): boolean {
  return (
    (health.oldestWaitSeconds ?? 0) >= QUEUE_STUCK_AFTER_SECONDS ||
    (health.oldestInFlightSeconds ?? 0) >= QUEUE_STUCK_AFTER_SECONDS
  );
}

export async function requestClaimCheck(body: CheckClaimRequest): Promise<CheckClaimResponse> {
  return call<CheckClaimResponse>(serviceUrl("CLAIM_CHECK_URL"), CHECK_CLAIM_PATH, body);
}

export async function requestClaimExtraction(body: ExtractClaimsRequest): Promise<ExtractClaimsResponse> {
  return call<ExtractClaimsResponse>(serviceUrl("EXTRACTION_URL"), EXTRACT_CLAIMS_PATH, body);
}

export async function fetchClaimCheckHealth(): Promise<HealthResponse> {
  return getHealth(serviceUrl("CLAIM_CHECK_URL"));
}

export async function fetchExtractionHealth(): Promise<HealthResponse> {
  return getHealth(serviceUrl("EXTRACTION_URL"));
}

async function call<Answer>(baseUrl: string, path: string, body: unknown): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { [SERVICE_AUTH_HEADER]: authSecret(), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  // The answer is read as text and parsed by hand, because a slow answer starts
  // with the newlines the service sends to keep the connection alive. JSON
  // ignores leading whitespace, so this parses either way.
  return parseAnswer<Answer>(await response.text(), response.status, path);
}

async function getHealth(baseUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
    headers: { [SERVICE_AUTH_HEADER]: authSecret() },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  return parseAnswer<HealthResponse>(await response.text(), response.status, HEALTH_PATH);
}

/** A health check is the one call that must fail fast. It is what a caller asks
 *  before deciding whether to start at all, so waiting minutes for it would
 *  defeat the point. */
const HEALTH_TIMEOUT_MS = 10_000;

function parseAnswer<Answer>(text: string, status: number, path: string): Answer {
  let parsed: Answer | ServiceErrorResponse;
  try {
    parsed = JSON.parse(text) as Answer | ServiceErrorResponse;
  } catch {
    throw new Error(`${path} answered with status ${status} and something that is not JSON: ${text.slice(0, 200)}`);
  }
  // A failure that happens after the answer started streaming cannot change the
  // status line, so the error field is what tells the two apart.
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new Error(`${path} failed: ${(parsed as ServiceErrorResponse).error}`);
  }
  return parsed as Answer;
}

function serviceUrl(variable: "CLAIM_CHECK_URL" | "EXTRACTION_URL"): string {
  const url = process.env[variable];
  if (!url) throw new Error(`Missing required environment variable: ${variable}`);
  return url.replace(/\/$/, "");
}

function authSecret(): string {
  const secret = process.env.SERVICE_AUTH_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SERVICE_AUTH_SECRET");
  return secret;
}

function timeoutMs(): number {
  const raw = process.env.SERVICE_CALL_TIMEOUT_MS;
  if (!raw) return DEFAULT_CALL_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`SERVICE_CALL_TIMEOUT_MS must be a number, got "${raw}"`);
  return value;
}

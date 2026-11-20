/** How much of X's error body a log line or a stored reason keeps. */
const X_ERROR_BODY_CHARS = 300;

/** axios keeps X's own explanation in the response body, which its message
 *  leaves out. Without the body, a stretch of 403s (as on the night of 20-21
 *  Sep 2026) cannot be diagnosed from the logs. */
export function describeXError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const response = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
  if (!response) return message;
  const body = response.data === undefined ? "" : ` body=${JSON.stringify(response.data).slice(0, X_ERROR_BODY_CHARS)}`;
  return `${message}; status ${response.status}${body}`;
}

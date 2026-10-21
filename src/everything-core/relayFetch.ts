// Lets a content script of the local-rerun extension build (GOO-495) make its
// database requests through the background. See the comment at relayedFetch
// in supabase.ts for why.

/** The message a content script sends to have the background make one
 *  database request for it. */
export const RELAY_DB_FETCH_MESSAGE = "cn-relay-db-fetch";

export interface RelayedRequest {
  type: typeof RELAY_DB_FETCH_MESSAGE;
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
}

export interface RelayedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

/** A message between extension parts can carry only plain data, so headers travel as name and value pairs. */
export function headerPairs(headers: Headers): [string, string][] {
  const pairs: [string, string][] = [];
  headers.forEach((value, name) => pairs.push([name, value]));
  return pairs;
}

/** Makes one database request for a content script and hands back the
 *  answer. The background calls it. */
export async function performRelayedRequest({ url, method, headers, body }: RelayedRequest): Promise<RelayedResponse> {
  const response = await fetch(url, { method, headers, body });
  return { status: response.status, statusText: response.statusText, headers: headerPairs(response.headers), body: await response.text() };
}

const NO_CONTENT_STATUSES = new Set([204, 205, 304]);

/** Turns the background's answer back into a Response for supabase-js. */
export function responseFromRelay(answer: RelayedResponse): Response {
  // A Response for "no content" statuses must not carry a body, not even an empty one.
  const bodyless = NO_CONTENT_STATUSES.has(answer.status);
  return new Response(bodyless ? null : answer.body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
}

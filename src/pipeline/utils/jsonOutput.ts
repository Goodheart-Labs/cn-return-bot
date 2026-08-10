/**
 * Strip a leading ```json fence and trailing ``` fence that some models wrap
 * around their JSON output despite a json_schema response_format. Shared by the
 * search dispatch and the writer so both tolerate the same provider quirk.
 */
export function stripJsonFences(content: string): string {
  return content.replace(/^```json\n?|\n?```$/g, "").trim();
}

/**
 * Extracts a JSON object from model output. Most models, such as gpt-5.x and
 * Sonar, emit bare JSON, sometimes wrapped in a ```json fence. For those,
 * stripping the fences is enough. Opus is the exception. When it is asked for
 * JSON without a strict response_format, it narrates a reasoning preamble before
 * the object. So we strip the fences first, and if a preamble is still in front
 * of the object we fall back to the slice from the first `{` to the last `}`.
 */
export function extractJsonObject(content: string): string {
  const stripped = stripJsonFences(content);
  if (stripped.startsWith("{")) return stripped;
  return content.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
}

const MAX_URL_CHARS_IN_LOG = 150;

/**
 * Shortens long URLs inside a string for error logging and leaves the rest of
 * the text intact. Use this instead of slicing the whole response. A single long
 * source URL would otherwise fill the entire log budget. That makes a reply which
 * was markdown instead of JSON look like a reply that was merely cut short.
 */
export function truncateUrlsForLog(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) =>
    url.length > MAX_URL_CHARS_IN_LOG
      ? `${url.slice(0, MAX_URL_CHARS_IN_LOG)}…(+${url.length - MAX_URL_CHARS_IN_LOG} chars)`
      : url,
  );
}

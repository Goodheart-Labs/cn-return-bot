/**
 * Strip a leading ```json fence and trailing ``` fence that some models wrap
 * around their JSON output despite a json_schema response_format. Shared by the
 * search dispatch and the writer so both tolerate the same provider quirk.
 */
export function stripJsonFences(content: string): string {
  return content.replace(/^```json\n?|\n?```$/g, "").trim();
}

/**
 * Extract a JSON object from model output. Most models (gpt-5.x, Sonar) emit bare
 * JSON — optionally ```json-fenced — so stripJsonFences alone is enough. Opus is
 * the exception: asked for JSON without a strict response_format, it narrates a
 * reasoning preamble before the object. Strip fences; if a preamble remains, fall
 * back to the first `{` … last `}` slice.
 */
export function extractJsonObject(content: string): string {
  const stripped = stripJsonFences(content);
  if (stripped.startsWith("{")) return stripped;
  return content.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
}

const MAX_URL_CHARS_IN_LOG = 150;

/**
 * Shorten long URLs inside a string for error logging while leaving the rest of
 * the text intact. Use this instead of slicing the whole response: a single long
 * source URL otherwise eats the entire budget and makes a markdown-instead-of-
 * JSON failure look like a truncated response.
 */
export function truncateUrlsForLog(text: string): string {
  return text.replace(/https?:\/\/\S+/g, (url) =>
    url.length > MAX_URL_CHARS_IN_LOG
      ? `${url.slice(0, MAX_URL_CHARS_IN_LOG)}…(+${url.length - MAX_URL_CHARS_IN_LOG} chars)`
      : url,
  );
}

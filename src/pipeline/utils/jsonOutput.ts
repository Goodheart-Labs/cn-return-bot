/**
 * Strip a leading ```json fence and trailing ``` fence that some models wrap
 * around their JSON output despite a json_schema response_format. Shared by the
 * search dispatch and the writer so both tolerate the same provider quirk.
 */
export function stripJsonFences(content: string): string {
  return content.replace(/^```json\n?|\n?```$/g, "").trim();
}

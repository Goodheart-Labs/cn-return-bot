/** Writes rows as tab-separated text with a header line. A field that holds a
 *  tab, a line break or a double quote is wrapped in double quotes, and its own
 *  double quotes are doubled. That is the quoting pandas and R read by default. */
export function toTsv(rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0] ?? {});
  const lines = [columns.join("\t"), ...rows.map((row) => columns.map((c) => tsvField(row[c])).join("\t"))];
  return lines.join("\n") + "\n";
}

function tsvField(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

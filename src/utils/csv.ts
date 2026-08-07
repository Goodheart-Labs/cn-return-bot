/** Parses CSV content. A quoted field may span several lines. */
export function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (inQuotes) {
      if (char === '"' && content[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else if (char === "\n" || (char === "\r" && content[i + 1] === "\n")) {
      if (char === "\r") i++;
      fields.push(current);
      current = "";
      records.push(fields);
      fields = [];
    } else {
      current += char;
    }
  }
  // The loop only finishes a record when it reaches a newline, so the last line
  // of a file that has no trailing newline is still pending here. When the file
  // did end with a newline there is nothing left, and the emptiness check below
  // throws the blank leftover away.
  fields.push(current);
  if (fields.some((f) => f.length > 0)) {
    records.push(fields);
  }
  return records;
}

export function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

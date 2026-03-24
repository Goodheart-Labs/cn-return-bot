/** Parse CSV content handling multiline quoted fields. */
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
  // Last record (no trailing newline)
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

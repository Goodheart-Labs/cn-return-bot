/** Stops the note writer's Claude from opening an image or a PDF with Read.
 *
 *  2026-11-09: three Claude accounts were banned after outside images reached
 *  the model. The prompts forbid images (NO_IMAGES in prompts.ts), but a prompt
 *  is only a request. This is a Claude Code PreToolUse hook that refuses the
 *  Read, and the runner adds it to every Claude it starts, on any box, whatever
 *  that box's own settings file holds.
 *
 *  Run as a script it is the hook: Claude Code's tool call arrives as JSON on
 *  stdin. A hook that cannot run exits 2, which also refuses the Read. */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import * as path from "path";

const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".ico", ".pdf"]);
const MAGIC = ["\x89PNG", "\xff\xd8\xff", "GIF8", "%PDF", "II*\x00", "MM\x00*"];
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"]);

export function looksLikeImage(filePath: string): boolean {
  if (EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true;
  let head: string;
  try {
    // Only a regular file: opening a pipe would hang the hook past its timeout.
    if (!statSync(filePath).isFile()) return false;
    const file = openSync(filePath, "r");
    try {
      const bytes = Buffer.alloc(16);
      head = bytes.subarray(0, readSync(file, bytes, 0, 16, 0)).toString("latin1");
    } finally {
      closeSync(file);
    }
  } catch {
    return false; // No file the runner's user can open, so Read shows no image either.
  }
  return (
    MAGIC.some((magic) => head.startsWith(magic)) ||
    (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") ||
    (head.startsWith("BM") && head.slice(6, 10) === "\0\0\0\0") || // a BMP header's reserved bytes
    (head.slice(4, 8) === "ftyp" && HEIF_BRANDS.has(head.slice(8, 12)))
  );
}

/** What the hook prints for one tool call: a refusal, or nothing to let it through. */
export function hookAnswer(input: string): string {
  const call = JSON.parse(input) as { tool_name?: string; cwd?: string; tool_input?: { file_path?: string } };
  const filePath = call.tool_input?.file_path;
  if (call.tool_name !== "Read" || typeof filePath !== "string") return "";
  if (!looksLikeImage(path.resolve(call.cwd ?? ".", filePath))) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `The note writer never opens an image or a PDF with Read (account bans, 2026-11-09). Do not copy or convert it to get around this. Work from text; for a PDF use pdftotext. Path: ${filePath}`,
    },
  });
}

/** The box's settings with the hook added. */
export function withImageGuard(settings: Record<string, any>): Record<string, any> {
  const command = `"${process.execPath}" "${import.meta.path}" || exit 2`;
  const guard = { matcher: "Read", hooks: [{ type: "command", command, timeout: 10 }] };
  return { ...settings, disableAllHooks: false, hooks: { ...settings.hooks, PreToolUse: [...(settings.hooks?.PreToolUse ?? []), guard] } };
}

/** Writes the box's settings file plus the hook into the run folder and returns
 *  the new file's path, for `claude --settings`. */
export function guardedSettingsFile(runDir: string, settingsFile: string): string {
  // A box with no settings file still gets the hook. A file that cannot be
  // parsed throws: starting Claude without the box's own rules would be worse.
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  const file = path.join(runDir, "settings.json");
  writeFileSync(file, JSON.stringify(withImageGuard(settings)));
  return file;
}

if (import.meta.main) process.stdout.write(hookAnswer(await Bun.stdin.text()));

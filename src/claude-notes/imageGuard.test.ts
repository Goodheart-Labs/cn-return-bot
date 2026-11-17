import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { guardedSettingsFile, hookAnswer } from "./imageGuard";

const dir = mkdtempSync(path.join(tmpdir(), "image-guard-"));
const read = (file_path: string, tool_name = "Read") => JSON.stringify({ tool_name, cwd: dir, tool_input: { file_path } });

test("refuses an image whatever its name, and a PDF", () => {
  writeFileSync(path.join(dir, "notes.txt"), Buffer.from("\x89PNG\r\n\x1a\n rest", "latin1"));
  expect(hookAnswer(read("notes.txt"))).toContain('"deny"');
  expect(hookAnswer(read("/nowhere/source.PDF"))).toContain('"deny"');
});

test("lets text and other tools through", () => {
  writeFileSync(path.join(dir, "post.md"), "BMW sold more cars. Plain text.".slice(3));
  expect(hookAnswer(read("post.md"))).toBe("");
  expect(hookAnswer(read("shot.png", "Bash"))).toBe("");
});

test("the settings file keeps the box's own hooks, and its hook refuses an image when Claude Code runs it", () => {
  const own = path.join(dir, "own.json");
  writeFileSync(own, JSON.stringify({ env: { A: "1" }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }], Stop: [] } }));
  const settings = JSON.parse(readFileSync(guardedSettingsFile(dir, own), "utf8"));
  expect(settings.env).toEqual({ A: "1" });
  expect(settings.hooks.Stop).toEqual([]);
  expect(settings.hooks.PreToolUse.map((h: { matcher: string }) => h.matcher)).toEqual(["Bash", "Read"]);

  const { command } = settings.hooks.PreToolUse[1].hooks[0];
  const run = (input: string) => spawnSync("sh", ["-c", command], { input, encoding: "utf8" });
  expect(run(read("shot.png")).stdout).toContain('"deny"');
  expect(run(read("post.md"))).toMatchObject({ status: 0, stdout: "" });
  expect(run("not json").status).toBe(2);
});

test("a box with no settings file still gets the hook", () => {
  const settings = JSON.parse(readFileSync(guardedSettingsFile(dir, path.join(dir, "missing.json")), "utf8"));
  expect(settings.hooks.PreToolUse).toHaveLength(1);
});

/* One Claude of the runner: a headless `claude -p` in its own detached tmux
 * session, so a person can attach and watch it, and so it survives a restart
 * of the runner. Everything the Claude leaves behind is in its run folder:
 * the prompt, the script that started it, Claude Code's output, what it wrote
 * to stderr, and its exit code. */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { guardedSettingsFile } from "../imageGuard";

const CLAUDE_BIN = process.env.CN_CLAUDE_BIN ?? path.join(homedir(), ".local/bin/claude");
/** Nathan's guard hook, which every unattended Claude on the ai-box runs under. */
const RUN_SETTINGS = process.env.CN_RUN_SETTINGS ?? "/srv/ai-box/run-settings.json";
const ENV_FILE = process.env.CN_ENV_FILE ?? "/etc/cn-notes/env";
/** The config folder of the notewriter's Claude account, or undefined for the
 *  login in the home folder, as on hq. */
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
/** The runner's secrets that no Claude needs: the service secret (only the
 *  runner calls the services box), the Slack and screening keys (only its
 *  alerts and image screen use them), and the notewriter key (only the runner
 *  reserves posts). The database keys stay, because the claude-notes commands
 *  the Claudes run need them. */
const SECRETS_NO_CLAUDE_NEEDS = [
  "SERVICE_AUTH_SECRET",
  "EXTRACTION_URL",
  "SLACK_BOT_TOKEN",
  "OPENAI_API_KEY",
  "ARACHNID_SHIELD_USERNAME",
  "ARACHNID_SHIELD_PASSWORD",
  "CN_NOTEWRITER_KEY",
];
/** Claude Code prefers an API key in its environment over the subscription
 *  login in its config folder, and is then billed per token. A box can pass
 *  such a key on without anyone meaning to: Bun loads a checkout's .env file
 *  into every script, and the devbox's holds ANTHROPIC_API_KEY. On 2026-11-25
 *  a post writer on the devbox ran on that key. So every writer starts without
 *  these variables, whatever the runner's environment holds. The isolated
 *  Claude starts with an empty environment and never gets them. */
const API_AUTH_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
/** The only variables an isolated Claude keeps. */
const ISOLATED_ENV_NAMES = ["HOME", "PATH", "USER", "LANG"];

/** On the main disk. /tmp on ai-box is a small tmpfs in memory with a quota per
 *  user, and a day of run folders is more than a gigabyte, which filled the
 *  quota on 2026-10-30 and crashed the runner. */
export const RUNS_DIR = process.env.CN_RUNS_DIR ?? "/var/tmp/cn-notes";

/** How to run one Claude. A writer works in its run folder with the runner's
 *  database keys and streams its output. An isolated Claude, the note judge,
 *  works in its empty run folder with none of the runner's secrets and answers
 *  one JSON object, so it can never read the votes it predicts. */
export type ClaudeCommand = {
  model: "opus" | "sonnet";
  effort?: "high" | "medium";
  appendSystemPromptFile?: string;
  /** Extra variables a writer's commands read, such as its run id. */
  env?: Record<string, string>;
  isolated?: { jsonSchema: object; tools: IsolatedTools };
};

/** The tools an isolated Claude has: Claude Code's default set without some
 *  of them, or none at all, as for the Pangram judge (GOO-880). */
export type IsolatedTools = { kind: "default_without"; disallowed: string[] } | { kind: "none" };

/** The run folder of one job, the same for every try of it. */
export function runFolder(kind: string, key: string): string {
  const dir = path.join(RUNS_DIR, kind, key);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const quoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function writerScript(runDir: string, command: ClaudeCommand): string[] {
  const file = (name: string) => path.join(runDir, name);
  const exports = { ...(CLAUDE_CONFIG_DIR && { CLAUDE_CONFIG_DIR }), ...command.env };
  const flags = [
    `--model ${command.model}`,
    ...(command.effort ? [`--effort ${command.effort}`] : []),
    ...(command.appendSystemPromptFile ? [`--append-system-prompt-file ${quoted(command.appendSystemPromptFile)}`] : []),
    // Claude Code puts the working folder, the git status and similar parts that
    // change from run to run into its system prompt, before the appended
    // examples. Each run then missed the prompt cache and wrote the examples
    // into it again, which was half of what a tweet cost (GOO-836). This flag
    // moves those parts into the first user message.
    "--exclude-dynamic-system-prompt-sections",
    "--permission-mode bypassPermissions",
    `--settings ${file("settings.json")}`,
    "--output-format stream-json --verbose",
  ];
  return [
    "set -a",
    `. ${ENV_FILE}`,
    "set +a",
    `unset ${[...SECRETS_NO_CLAUDE_NEEDS, ...API_AUTH_VARIABLES].join(" ")}`,
    // A tmux session takes its environment from the tmux server, which may be
    // older than the runner, so the account's folder is set here.
    ...Object.entries(exports).map(([name, value]) => `export ${name}=${quoted(value)}`),
    `export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"`,
    // Every prompt names its folders and commands in full, so a writer starts in
    // its run folder. In the checkout it would read the repository's CLAUDE.md
    // and skills, about 20,000 tokens that only a Claude working on the code needs.
    `cd ${runDir}`,
    `"${CLAUDE_BIN}" -p "$(cat ${file("prompt.md")})" ${flags.join(" ")} > ${file("stream.jsonl")} 2> ${file("stderr.txt")}`,
  ];
}

function isolatedScript(runDir: string, command: ClaudeCommand, isolated: NonNullable<ClaudeCommand["isolated"]>): string[] {
  writeFileSync(path.join(runDir, "schema.json"), JSON.stringify(isolated.jsonSchema));
  const kept = [
    ...ISOLATED_ENV_NAMES.map((name) => `${name}="$${name}"`),
    ...(CLAUDE_CONFIG_DIR ? [`CLAUDE_CONFIG_DIR=${quoted(CLAUDE_CONFIG_DIR)}`] : []),
  ];
  const flags = [
    `--model ${command.model}`,
    ...(command.effort ? [`--effort ${command.effort}`] : []),
    ...(command.appendSystemPromptFile ? [`--append-system-prompt-file ${quoted(command.appendSystemPromptFile)}`] : []),
    "--permission-mode bypassPermissions --settings settings.json",
    isolated.tools.kind === "none" ? `--tools ""` : `--disallowedTools ${isolated.tools.disallowed.map(quoted).join(" ")}`,
    `--output-format json --json-schema "$(cat schema.json)" --no-session-persistence`,
  ];
  return [`cd ${runDir}`, `env -i ${kept.join(" ")} "${CLAUDE_BIN}" -p "$(cat prompt.md)" ${flags.join(" ")} > output.json 2> stderr.txt`];
}

/** Starts the Claude in a detached tmux session. The secrets come from the env
 *  file inside the session, so they never appear in a process's arguments. */
export function startSession(session: string, runDir: string, prompt: string, command: ClaudeCommand) {
  writeFileSync(path.join(runDir, "prompt.md"), prompt);
  guardedSettingsFile(runDir, RUN_SETTINGS);
  const lines = command.isolated ? isolatedScript(runDir, command, command.isolated) : writerScript(runDir, command);
  writeFileSync(path.join(runDir, "run.sh"), [...lines, `echo $? > ${path.join(runDir, "exit-code")}`].join("\n"));
  const started = spawnSync("tmux", ["new-session", "-d", "-s", session, "bash", path.join(runDir, "run.sh")]);
  if (started.status !== 0) throw new Error(`tmux could not start ${session}: ${started.stderr}`);
}

export const sessionAlive = (session: string) => spawnSync("tmux", ["has-session", "-t", `=${session}`]).status === 0;

export function stopSession(session: string) {
  spawnSync("tmux", ["kill-session", "-t", `=${session}`]);
}

/** When the job's Claude was started, from its prompt file, for a runner that
 *  picks up a Claude after a restart. Null when it never started. */
export function sessionStartedAt(runDir: string): number | null {
  const prompt = path.join(runDir, "prompt.md");
  return existsSync(prompt) ? statSync(prompt).mtimeMs : null;
}

type ResultEvent = { type: "result"; is_error?: boolean; result?: unknown; total_cost_usd?: number; structured_output?: unknown };

/** The last event of Claude Code's output, which says how the run ended and
 *  what it cost: stream.jsonl for a writer, output.json for an isolated
 *  Claude. Null when the run died before it reported. */
export function resultEvent(runDir: string): ResultEvent | null {
  const output = ["stream.jsonl", "output.json"].map((file) => path.join(runDir, file)).find(existsSync);
  if (!output) return null;
  for (const line of readFileSync(output, "utf8").trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result") return event;
    } catch {
      // A run killed mid-write leaves a cut-off last line.
    }
  }
  return null;
}

const MAX_FAILURE_TEXT_CHARS = 300;
const readIfExists = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");

/** What went wrong in a Claude session, or null when Claude Code finished
 *  without an error. A banned account, a rate limit or a broken install all
 *  end this way, whatever the job was. */
export function claudeFailure(runDir: string): string | null {
  const exitCode = readIfExists(path.join(runDir, "exit-code"));
  const result = resultEvent(runDir);
  if (exitCode === "0" && result && !result.is_error) return null;
  const stderr = readIfExists(path.join(runDir, "stderr.txt")).split("\n")[0];
  const said = (result?.is_error && String(result.result)) || stderr || `Claude Code exited with ${exitCode || "no exit code"} and no result`;
  return said.slice(0, MAX_FAILURE_TEXT_CHARS);
}

/** Claude Code renews its login token only when it runs. While nothing runs,
 *  the token in the credentials file expires, and the usage endpoint answers
 *  401. A tiny Claude call renews the token. */
export function renewClaudeLogin() {
  const renewed = spawnSync(CLAUDE_BIN, ["-p", "Reply with OK", "--model", "haiku"], { cwd: RUNS_DIR, encoding: "utf8", timeout: 120_000 });
  console.log(renewed.status === 0 ? "Renewed the Claude login" : `Could not renew the Claude login: ${renewed.stderr}`);
}

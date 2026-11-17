/* The notewriter protocol from the command line (GOO-724). Every command
 * calls one database function of migration 168 and prints its answer. See
 * docs/notewriter-protocol.md for the whole protocol.
 *
 * Usage: bun run notewriter <command> [arguments]
 *   next <notewriter>                          asks for a post
 *   note <notewriter> <item id> <note.json>    posts one note: { passage, note, sources: [{ url, quote, explanation }] }
 *   finish <assignment> [summary.json]         done with the post
 *   skip <assignment> <reason>                 done, because the post is not worth checking
 *   fail <assignment> <reason>                 could not finish the post
 *   subscribe <notewriter> <minutes | off> [requests=on | requests=off]
 *   status <notewriter>                        settings, break, held posts, last failures
 *   add <notewriter> <name> <owner> [lease minutes]
 *                                              creates a notewriter, for admins */

import { readFileSync } from "fs";
import { db } from "../serviceDb";
import { addNote, fail, finish, nextPost, status, subscribe } from "./protocol";

const [command, ...args] = process.argv.slice(2);

function arg(index: number): string {
  const value = args[index];
  if (value === undefined) throw new Error(`${command} needs more arguments. See the usage at the top of src/notewriters/cli.ts`);
  return value;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
/** The words from the second argument on, such as a reason. */
function words(): string {
  arg(1);
  return args.slice(1).join(" ");
}

function parseMinutes(value: string): number | null {
  if (value === "off") return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error(`Give whole minutes or "off", not ${value}`);
  return minutes;
}

function parseRequests(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "requests=on") return true;
  if (value === "requests=off") return false;
  throw new Error(`Give requests=on or requests=off, not ${value}`);
}

async function addNotewriter(id: string, name: string, owner: string, leaseMinutes: string | undefined) {
  const { error } = await db()
    .from("everything_notewriters")
    .insert({ id, name, owner, ...(leaseMinutes && { lease_minutes: Number(leaseMinutes) }) });
  if (error) throw new Error(error.message);
  return status(id);
}

async function run(): Promise<unknown> {
  switch (command) {
    case "next":
      return nextPost(arg(0));
    case "note":
      return addNote(arg(0), arg(1), readJson(arg(2)));
    case "finish":
      return finish(arg(0), { summary: args[1] ? readJson(args[1]) : undefined });
    case "skip":
      return finish(arg(0), { skipReason: words() });
    case "fail":
      return fail(arg(0), words());
    case "subscribe":
      return subscribe(arg(0), parseMinutes(arg(1)), parseRequests(args[2]));
    case "status":
      return status(arg(0));
    case "add":
      return addNotewriter(arg(0), arg(1), arg(2), args[3]);
    default:
      throw new Error(`Unknown command ${command}. See the usage at the top of src/notewriters/cli.ts`);
  }
}

console.log(JSON.stringify(await run(), null, 2));

/* The notewriters from the command line (GOO-724, GOO-791). Every command
 * calls one database function and prints its answer. docs/notewriter-api.md
 * describes the API.
 *
 * Usage: bun run notewriter <command> [arguments]
 *
 * API v1, with the secret key and the notewriter's name:
 *   next <notewriter>                          asks for a post
 *   note <notewriter> <item id> <note.json>    posts one note on a post it holds: { passage, note, sources: [{ url, quote, explanation }] }
 *   finish <assignment> [summary.json]         done with the post
 *   skip <assignment> <reason>                 done, because the post is not worth checking
 *   fail <assignment> <reason>                 could not finish the post
 *   subscribe <notewriter> <minutes | off> [requests=on | requests=off]
 *   status <notewriter>                        settings, held posts, last failures
 *
 * API v2, as the notewriter whose key is in CN_NOTEWRITER_KEY:
 *   me                                         limits, open reservations, health
 *   posts [limit] [team]                       a page of the list; "team" counts only our own notewriters
 *   reserve <post id> [at most]                reserves a post
 *
 * For admins, with the secret key:
 *   add <notewriter> <name> <owner> [lease minutes]
 *                                              one of our own notewriters, without a key
 *   create <notewriter> <name> <owner> <contact email> [notes a day] [open at once]
 *                                              an outside notewriter; prints its key once
 *   new-key <notewriter>                       ends its keys and prints a new one
 *   switch <notewriter> on | off [reason]      off refuses its key and ends its open reservations */

import { readFileSync } from "fs";
import { db } from "../serviceDb";
import { notewriterClient } from "./client";
import { addNote, fail, finish, nextPost, status, subscribe } from "./v1";

const [command, ...args] = process.argv.slice(2);

function arg(index: number): string {
  const value = args[index];
  if (value === undefined) throw new Error(`${command} needs more arguments. See the usage at the top of src/notewriters/cli.ts`);
  return value;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
/** The words from the given argument on, such as a reason. */
function words(from: number): string {
  arg(from);
  return args.slice(from).join(" ");
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

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** The API v2 client of the notewriter whose key is in CN_NOTEWRITER_KEY. */
function client() {
  db();
  const notewriterKey = process.env.CN_NOTEWRITER_KEY;
  if (!notewriterKey) throw new Error("Put the notewriter's key in CN_NOTEWRITER_KEY");
  return notewriterClient({ supabaseUrl: process.env.SUPABASE_URL!, apiKey: process.env.SUPABASE_SERVICE_KEY!, notewriterKey });
}

async function addNotewriter(id: string, name: string, owner: string, leaseMinutes: string | undefined) {
  unwrap(await db().from("everything_notewriters").insert({ id, name, owner, ...(leaseMinutes && { lease_minutes: Number(leaseMinutes) }) }));
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
      return finish(arg(0), { skipReason: words(1) });
    case "fail":
      return fail(arg(0), words(1));
    case "subscribe":
      return subscribe(arg(0), parseMinutes(arg(1)), parseRequests(args[2]));
    case "status":
      return status(arg(0));
    case "me":
      return client().me();
    case "posts":
      return client().posts({ limit: args[0] ? Number(args[0]) : 10, othersFrom: args[1] === "team" ? "team" : "everyone" });
    case "reserve":
      return client().reserve(arg(0), args[1] ? Number(args[1]) : 1);
    case "add":
      return addNotewriter(arg(0), arg(1), arg(2), args[3]);
    case "create":
      return unwrap(
        await db().rpc("notewriter_admin_create", {
          p_id: arg(0), p_name: arg(1), p_owner: arg(2), p_contact: arg(3),
          ...(args[4] && { p_notes_per_day: Number(args[4]) }),
          ...(args[5] && { p_max_open: Number(args[5]) }),
        }),
      );
    case "new-key":
      return unwrap(await db().rpc("notewriter_admin_new_key", { p_notewriter: arg(0) }));
    case "switch":
      if (arg(1) !== "on" && arg(1) !== "off") throw new Error(`Give on or off, not ${arg(1)}`);
      return unwrap(await db().rpc("notewriter_admin_switch", { p_notewriter: arg(0), p_on: arg(1) === "on", p_reason: args[2] ? words(2) : undefined }));
    default:
      throw new Error(`Unknown command ${command}. See the usage at the top of src/notewriters/cli.ts`);
  }
}

console.log(JSON.stringify(await run(), null, 2));

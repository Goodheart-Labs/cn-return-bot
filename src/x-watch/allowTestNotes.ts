/**
 * Lets cn-x-watch write n more test notes (GOO-851, room.ts). It raises the
 * account's allowance in pipeline_state by n and prints where the account
 * stands. The daemon picks the new allowance up on its next tick.
 *
 *   bun run x-watch-allow-test-notes <n>
 */

import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { currentXAccount } from "../api/xAccount";
import { readWriterState, stateKey } from "./db";

const more = Number(process.argv[2]);
if (!Number.isInteger(more) || more <= 0) throw new Error("Usage: bun run x-watch-allow-test-notes <n>, where n is a whole number above 0");

const logger = new SupabaseLogger();
const state = await readWriterState(logger);
if (state.kind !== "testing") throw new Error(`X already admitted ${currentXAccount()}, so it writes no test notes any more`);
const allowance = state.testNoteAllowance + more;
await logger.setPipelineState(stateKey("test_note_allowance"), String(allowance));
console.log(`${currentXAccount()} has submitted ${state.testNotesSubmitted} test notes and may now write ${allowance} in total, ${allowance - state.testNotesSubmitted} more.`);

import type { ReaderModule } from "../context";
import { askOpusModule } from "./askOpus";
import { contentsModule } from "./contents";
import { highlightsModule } from "./highlights";
import { notesModule } from "./notes";
import { requestNoteModule } from "./requestNote";
import { writeNoteModule } from "./writeNote";

/** Every feature module, in the order their buttons and margin entries
 *  appear: notes first, then note requests, then key points and forecasts,
 *  then Ask Opus. */
export const READER_MODULES: readonly ReaderModule[] = [notesModule, writeNoteModule, requestNoteModule, highlightsModule, askOpusModule, contentsModule];

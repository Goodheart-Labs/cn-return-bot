import { supabase } from "./supabase";

/** Asks the judge-note edge function whether a proposed note is written in good faith
 *  or is trolling. The proposed note can be a new note or an improvement to an
 *  existing one. The judge runs on the server, so the OpenRouter key stays there. The
 *  caller posts the note only when this returns true. The user must be signed in.
 *  `context` is the claim the note is written against. `currentNote` holds the
 *  existing note when this is an improvement. */
export async function isEarnestNote(
  note: string,
  context: string,
  currentNote?: string,
): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("judge-note", {
    body: { note, context, current_note: currentNote ?? "" },
  });
  if (error) {
    // An edge function reports any non-2xx response as a FunctionsHttpError, so we
    // have to read the real message out of the response body.
    const detail = await (error as any).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return (data as { status: string }).status === "accepted";
}

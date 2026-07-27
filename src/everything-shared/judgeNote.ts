import { supabase } from "./supabase";

/** Ask the judge-note edge function whether a proposed note (a new note or an
 *  improvement) is an earnest good-faith note vs trolling. The OpenRouter key
 *  stays server-side; the caller posts the note only when this returns true.
 *  Requires a signed-in user. `context` is the claim/anchor being noted;
 *  `currentNote` is the existing note when this is an improvement. */
export async function isEarnestNote(
  note: string,
  context: string,
  currentNote?: string,
): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("judge-note", {
    body: { note, context, current_note: currentNote ?? "" },
  });
  if (error) {
    // Edge functions surface non-2xx as FunctionsHttpError; dig out the message.
    const detail = await (error as any).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return (data as { status: string }).status === "accepted";
}

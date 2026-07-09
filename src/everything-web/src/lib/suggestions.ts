import { supabase } from "./supabase";

export interface JudgeResult {
  status: "accepted" | "rejected";
  reason: string;
}

/** Submit a proposed better note; the judge-suggestion edge function decides
 *  earnest vs trolling and stores accepted ones. Requires a signed-in user. */
export async function submitImprovement(noteId: string, text: string): Promise<JudgeResult> {
  const { data, error } = await supabase.functions.invoke("judge-suggestion", {
    body: { note_id: noteId, suggested_text: text },
  });
  if (error) {
    // Edge functions surface non-2xx as FunctionsHttpError; dig out the message.
    const detail = await (error as any).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as JudgeResult;
}

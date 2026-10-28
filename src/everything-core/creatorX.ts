import { supabase } from "./supabase";

/* The X account of a project's creator (migration 154): a handle, or the fact
 * that the creator has none, with a sentence of evidence. The Claude note
 * writer's runner looks it up, and an admin can correct it on the review
 * page. */

/** Records the creator's handle, or with null that they have no X account. */
export async function setCreatorXHandle(projectSlug: string, handle: string | null, evidence: string): Promise<void> {
  const { error } = await supabase.rpc("everything_set_x_handle", {
    p_project_slug: projectSlug,
    // The database reads a missing handle as "no X account".
    p_handle: handle as string,
    p_evidence: evidence,
  });
  if (error) throw new Error(`could not save the X account: ${error.message}`);
}

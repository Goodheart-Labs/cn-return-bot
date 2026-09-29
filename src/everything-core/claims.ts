import { supabase } from "./supabase";
import type { ClaimRef } from "./types";

export type CheckedClaim = Pick<ClaimRef, "id" | "context_quote" | "context_paragraph" | "updated_quote"> & {
  status: "note" | "no_note";
};

export async function fetchCheckedClaimsForItem(itemId: string): Promise<CheckedClaim[]> {
  const claims: CheckedClaim[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("everything_claims")
      .select("id, context_quote, context_paragraph, updated_quote, status")
      .eq("item_id", itemId)
      .is("created_by", null)
      .neq("judgement", "user")
      .in("status", ["note", "no_note"])
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    claims.push(...data as CheckedClaim[]);
    if (data.length < pageSize) return claims;
  }
}

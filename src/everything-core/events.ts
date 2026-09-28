import type { Json } from "./database.types";
import { supabase } from "./supabase";

/** Inserts one analytics event into everything_events (migration 077), which
 *  clients may only insert into. Both apps' analytics transports end here.
 *  Analytics is a side channel, so a failed insert is logged and reported as
 *  false, and never thrown. */
export async function insertEvent(row: {
  event: string;
  platform: "web" | "extension";
  deviceId: string;
  userId: string | null;
  props: Record<string, unknown>;
}): Promise<boolean> {
  const { error } = await supabase.from("everything_events").insert({
    event: row.event,
    platform: row.platform,
    device_id: row.deviceId,
    user_id: row.userId,
    props: row.props as Json,
  });
  if (error) console.debug("analytics insert failed", error.message);
  return !error;
}

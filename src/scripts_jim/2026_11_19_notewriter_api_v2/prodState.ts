/* Read-only: the production state the notewriter API v2 migration (184) starts from. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const show = (label: string, value: unknown) => console.log(label, JSON.stringify(value, null, 1));

show("notewriters", (await db.from("everything_notewriters").select("*")).data);
show("open assignments", (await db.from("everything_assignments").select("id, notewriter_id, started_at, deadline").is("ended_at", null)).data);
for (const outcome of ["done", "skipped", "failed", "expired"]) {
  show(`assignments ${outcome}`, (await db.from("everything_assignments").select("id", { count: "exact", head: true }).eq("outcome", outcome)).count);
}
show("items", (await db.from("everything_items").select("id", { count: "exact", head: true })).count);
show("items queued", (await db.from("everything_items").select("id", { count: "exact", head: true }).eq("status", "queued")).count);
show("items requested tier queued", (await db.from("everything_items").select("id", { count: "exact", head: true }).eq("status", "queued").gte("priority", 2)).count);
show("checked items", (await db.from("everything_items").select("id", { count: "exact", head: true }).not("first_checked_at", "is", null)).count);
show("requests by status", (await db.from("everything_note_requests").select("status, selection").in("status", ["pending", "enqueued"]).limit(30)).data);
show("note vote columns", Object.keys((await db.from("everything_notes").select("*").limit(1)).data?.[0] ?? {}));
show("item columns", Object.keys((await db.from("everything_items").select("*").limit(1)).data?.[0] ?? {}));
show("project columns", Object.keys((await db.from("everything_projects").select("*").limit(1)).data?.[0] ?? {}));

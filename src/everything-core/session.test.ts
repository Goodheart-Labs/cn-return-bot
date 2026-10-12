import { expect, test } from "bun:test";
import type { Session } from "@supabase/supabase-js";
import { displayName } from "./session";

const session = (user: { email?: string; user_metadata?: Record<string, unknown> }) => ({ user: { user_metadata: {}, ...user } }) as unknown as Session;

test("displayName skips blank names and emails", () => {
  expect(displayName(session({ email: "", user_metadata: {} }))).toBe("anonymous");
  expect(displayName(session({ email: "" }))).toBe("anonymous");
  expect(displayName(session({ email: "ada@example.com", user_metadata: { user_name: "", full_name: " " } }))).toBe("ada");
  expect(displayName(session({ email: "", user_metadata: { user_name: "", full_name: "Ada Lovelace" } }))).toBe("Ada Lovelace");
  expect(displayName(session({ email: "ada@example.com", user_metadata: { user_name: "ada_x", full_name: "Ada Lovelace" } }))).toBe("ada_x");
});

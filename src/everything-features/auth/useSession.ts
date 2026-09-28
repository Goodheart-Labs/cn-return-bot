import { useSyncExternalStore } from "react";
import { currentSessionState, subscribeToSession, type SessionState } from "@cn/core/auth";

/** The signed-in session, kept current across sign-ins, sign-outs and, in the
 *  extension, sign-ins that happen in another part of the extension. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribeToSession, currentSessionState);
}

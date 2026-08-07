import { useEffect, useState } from "react";
import { browser } from "#imports";
import { EMAIL_OTP_LENGTH, signInWithEmailCode, verifyEmailCode } from "../../everything-shared/auth";
import { track } from "../../everything-shared/analytics";

// The popup CLOSES when the user switches to their mail client to fetch the
// code, wiping React state — persist the awaiting-code email so reopening the
// popup lands back on the code input. storage.session dies with the browser
// (no stale pending logins); older Firefox lacks it, hence the local fallback.
const PENDING_EMAIL_KEY = "cn-login-pending-email";
const pendingStore = () => browser.storage.session ?? browser.storage.local;

/** Popup sign-in: email → 8-digit code (no redirects), or X OAuth via the
 *  background's launchWebAuthFlow. Session lands in chrome.storage.local and
 *  reaches every context through useSession's storage listener. */
export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pendingStore().get(PENDING_EMAIL_KEY).then((stored) => {
      const pending = stored[PENDING_EMAIL_KEY] as string | undefined;
      if (pending) {
        setEmail(pending);
        setStage("code");
      }
    });
  }, []);

  const backToEmail = async () => {
    await pendingStore().remove(PENDING_EMAIL_KEY);
    setStage("email");
    setCode("");
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    track("sign_in_started", { method: "email" });
    const { error } = await signInWithEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    await pendingStore().set({ [PENDING_EMAIL_KEY]: email.trim() });
    setStage("code");
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    setBusy(false);
    if (error) return setError(error.message);
    await pendingStore().remove(PENDING_EMAIL_KEY);
  };

  const signInWithX = async () => {
    setBusy(true);
    setError(null);
    track("sign_in_started", { method: "twitter" });
    const result = await browser.runtime.sendMessage({ type: "cn-signin-x" }) as { ok: boolean; error?: string };
    setBusy(false);
    if (!result?.ok) setError(result?.error ?? "X sign-in failed");
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">Sign in to vote or write notes</p>
      {stage === "email" ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !email.includes("@")}
            className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            Send code
          </button>
        </form>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="text-xs text-gray-500">Enter the code we sent to {email.trim()}.</p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345678"
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm tracking-widest"
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < EMAIL_OTP_LENGTH}
              className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Verify
            </button>
          </div>
          <button type="button" onClick={backToEmail} className="text-xs text-gray-500 hover:underline">
            Different email
          </button>
        </form>
      )}
      <button
        onClick={signInWithX}
        disabled={busy}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-40"
      >
        Sign in with 𝕏
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

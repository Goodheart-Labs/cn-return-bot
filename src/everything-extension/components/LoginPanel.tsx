import { useState } from "react";
import { browser } from "#imports";
import { signInWithEmailCode, verifyEmailCode } from "../../everything-shared/auth";

/** Popup sign-in: email → 6-digit code (no redirects), or X OAuth via the
 *  background's launchWebAuthFlow. Session lands in chrome.storage.local and
 *  reaches every context through useSession's storage listener. */
export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    setStage("code");
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    setBusy(false);
    if (error) return setError(error.message);
  };

  const signInWithX = async () => {
    setBusy(true);
    setError(null);
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
          <p className="text-xs text-gray-500">We emailed a 6-digit code to {email.trim()}.</p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm tracking-widest"
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Verify
            </button>
          </div>
          <button type="button" onClick={() => { setStage("email"); setCode(""); }} className="text-xs text-gray-500 hover:underline">
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

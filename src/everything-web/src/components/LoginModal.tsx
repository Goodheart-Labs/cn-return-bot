import { useRef, useState } from "react";
import { signInWithEmailCode, verifyEmailCode, signInWithTwitter } from "../../../everything-shared/auth";

const X_SIGNIN_ENABLED = true;

/** Email sign-in is a 6-digit code typed here (same flow as the extension
 *  popup) — the tab keeps its state while the user fetches the code, so no
 *  persistence is needed. Verifying sets the session in this context, so the
 *  modal closes itself. */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropPress = useRef(false);

  if (!open) return null;

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signInWithEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    setStage("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await verifyEmailCode(email.trim(), code.trim());
    setBusy(false);
    if (error) return setError(error.message);
    onClose();
  };

  const backToEmail = () => {
    setStage("email");
    setCode("");
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPress.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold">Sign in to vote</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500">Voting and suggesting improvements need a quick sign-in. Reading notes doesn't.</p>

        {stage === "email" ? (
          <form onSubmit={sendCode} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-2">
            <p className="text-sm text-gray-500">Enter the code we sent to <span className="font-medium text-gray-700">{email.trim()}</span>.</p>
            <input
              inputMode="numeric"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-widest"
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Verify
            </button>
            <button type="button" onClick={backToEmail} className="text-xs text-gray-500 hover:underline">
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {X_SIGNIN_ENABLED && (
          <>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="flex-1 border-t" /> or <span className="flex-1 border-t" />
            </div>
            <button
              onClick={() => signInWithTwitter()}
              className="w-full border border-gray-800 bg-black text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800"
            >
              Sign in with 𝕏
            </button>
          </>
        )}
      </div>
    </div>
  );
}

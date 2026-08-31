import { useState } from "react";
import { BUTTON, INPUT, QUIET_LINK } from "../../../everything-shared/ui";
import { Modal } from "./Modal";
import { EMAIL_OTP_LENGTH, signInWithEmailCode, verifyEmailCode, signInWithTwitter, type EmailFlow } from "../../../everything-shared/auth";
import { track } from "../../../everything-shared/analytics";

const X_SIGNIN_ENABLED = true;

/** Email sign-in works by typing an 8-digit code into this modal. It is the same
 *  flow the extension popup uses. The tab keeps its state while the user goes to
 *  fetch the code from their inbox, so nothing has to be persisted. Verifying the
 *  code sets the session in this same context, so the modal can simply close
 *  itself. */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  // Whether the code signs into an account or attaches the email to the
  // current anonymous one. Decided when the code is sent, needed to verify it.
  const [flow, setFlow] = useState<EmailFlow>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    track("sign_in_started", { method: "email" });
    const { error, flow: sentFlow } = await signInWithEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    // "done" means the email attached without a code (confirmations off on
    // this backend). The session already updated, so the modal can close.
    if (sentFlow === "done") return onClose();
    setFlow(sentFlow);
    setStage("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await verifyEmailCode(email.trim(), code.trim(), flow);
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
    <Modal title="Sign in" onClose={onClose}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Signing in keeps your votes and notes together across devices. Reading and voting work without it.</p>

        {stage === "email" ? (
          <form onSubmit={sendCode} className="space-y-2">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`w-full ${INPUT}`}
            />
            <button
              type="submit"
              disabled={busy}
              className={`w-full ${BUTTON}`}
            >
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">Enter the code we sent to <span className="font-medium text-gray-700 dark:text-gray-300">{email.trim()}</span>.</p>
            <input
              inputMode="numeric"
              name="one-time-code"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`w-full ${INPUT} tracking-widest`}
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < EMAIL_OTP_LENGTH}
              className={`w-full ${BUTTON}`}
            >
              Verify
            </button>
            <button type="button" onClick={backToEmail} className={`text-xs ${QUIET_LINK}`}>
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {X_SIGNIN_ENABLED && (
          <>
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <span className="flex-1 border-t border-gray-200 dark:border-gray-700" /> or <span className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>
            <button
              onClick={() => { track("sign_in_started", { method: "twitter" }); signInWithTwitter(); }}
              className="w-full bg-black text-white border border-gray-800 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
            >
              Sign in with 𝕏
            </button>
          </>
        )}
    </Modal>
  );
}

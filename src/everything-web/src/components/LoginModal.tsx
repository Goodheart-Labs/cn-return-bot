import { signInWithTwitter } from "@cn/core/auth";
import { SignInForm } from "@cn/features/auth/SignInForm";
import { Modal } from "@cn/ui/Modal";

/** The website's sign-in, in a modal. Email sign-in works by typing the code
 *  we send into the form, and the tab keeps the form's state while the reader
 *  fetches it from their inbox. Verifying the code sets the session in this
 *  same tab, so the modal can simply close. */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal title="Sign in" onClose={onClose}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Signing in keeps your votes and notes together across devices. Reading and voting work without it.
      </p>
      <SignInForm
        surface="web"
        signInWithX={async () => ({ error: (await signInWithTwitter()).error?.message })}
        onSignedIn={onClose}
      />
    </Modal>
  );
}

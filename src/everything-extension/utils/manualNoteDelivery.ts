/** A tab may receive messages before React has installed the editor listener.
 * An unrelated listener's empty response is not confirmation that it opened.
 * Inject once if no content script answers, then wait for the editor itself. */
export async function deliverManualNote({ send, inject, pause, attempts = 100 }: {
  send: () => Promise<unknown>;
  inject: () => Promise<unknown>;
  pause: () => Promise<void>;
  attempts?: number;
}): Promise<boolean> {
  let injected = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const reply = await send();
      if ((reply as { opened?: boolean } | null)?.opened === true) return true;
    } catch {
      if (!injected) {
        injected = true;
        try {
          await inject();
        } catch {
          return false;
        }
      }
    }
    if (attempt + 1 < attempts) await pause();
  }
  return false;
}

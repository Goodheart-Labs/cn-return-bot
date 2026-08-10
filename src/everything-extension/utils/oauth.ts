import { browser } from "#imports";
import { supabase } from "../../everything-shared/supabase";

/** Signs the user in with X from the background script. Supabase builds the provider
 *  URL but does not open it, because `skipBrowserRedirect` is set and we open the
 *  window ourselves. launchWebAuthFlow then runs the OAuth exchange in a popup
 *  window. This is the implicit flow, so the tokens come back in the hash of the
 *  extension's redirect URL, and we hand them to setSession.
 *
 *  The extension's redirect URL must be on the Supabase redirect allow-list. It is
 *  whatever browser.identity.getRedirectURL() returns. That is an address on
 *  chromiumapp.org in Chrome and on extensions.allizom.org in Firefox. */
export async function signInWithXViaWebAuthFlow(): Promise<{ ok: boolean; error?: string }> {
  try {
    const redirectTo = browser.identity.getRedirectURL();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "twitter",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { ok: false, error: error?.message ?? "could not start OAuth" };

    const resultUrl = await browser.identity.launchWebAuthFlow({ url: data.url, interactive: true });
    if (!resultUrl) return { ok: false, error: "sign-in window closed" };

    const params = new URLSearchParams(new URL(resultUrl).hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      return { ok: false, error: params.get("error_description") ?? "no tokens in OAuth redirect" };
    }
    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessionError) return { ok: false, error: sessionError.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

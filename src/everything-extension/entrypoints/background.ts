import { defineBackground } from "#imports";
import { browser } from "#imports";
import { signInWithXViaWebAuthFlow } from "../utils/oauth";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if ((message as { type?: string })?.type === "cn-signin-x") {
      // The OAuth window outlives the popup that asked for it, so the flow
      // runs here in the background.
      signInWithXViaWebAuthFlow().then(sendResponse);
      return true; // async response
    }
    return undefined;
  });
});

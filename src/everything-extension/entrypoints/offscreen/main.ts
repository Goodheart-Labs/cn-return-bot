import { browser } from "#imports";
import { COLOR_SCHEME_MESSAGE_TYPE, type ColorSchemeMessage } from "../../utils/toolbarIcon";

/* Tells the background the browser's colour scheme now and on every change.
 * See utils/toolbarIcon.ts for why this page exists. */
const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
const report = () => browser.runtime.sendMessage({ type: COLOR_SCHEME_MESSAGE_TYPE, dark: darkMode.matches } satisfies ColorSchemeMessage);
void report();
darkMode.addEventListener("change", () => void report());

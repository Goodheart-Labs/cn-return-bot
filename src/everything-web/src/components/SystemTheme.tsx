import { useEffect } from "react";

/** Follows the operating system's theme: a dark system gets the `.dark` class
 *  on <html>, which is the same switch the browser extension uses for its
 *  shadow roots. index.html sets the class before first paint; this keeps it
 *  in sync when the OS theme changes while the page is open. */
export function SystemTheme() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return null;
}

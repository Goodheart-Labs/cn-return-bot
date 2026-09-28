/* Stands in for WXT's `#imports` module, which only exists inside an extension
 * build. `fakeBrowser` is the in-memory browser API that WXT itself uses for
 * testing: storage and messaging work, and nothing leaves the page. */
export { fakeBrowser as browser } from "@webext-core/fake-browser";

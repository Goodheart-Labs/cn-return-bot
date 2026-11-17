/* Lets `bun test` load extension code. WXT's `#imports` module only exists
 * inside an extension build, so every test file gets an in-memory stand-in:
 * `fakeBrowser`, the browser API that WXT itself uses for testing, where
 * storage and messaging work and nothing leaves the page. bunfig.toml loads
 * this file before the tests.
 *
 * The shared Supabase client refuses to load without an address, and CI has
 * none. Tests get an address where nothing listens, even when a local .env
 * holds the real one, so no test can ever reach production. */
import { mock } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";

process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "test-anon-key";

mock.module("#imports", () => ({ browser: fakeBrowser }));

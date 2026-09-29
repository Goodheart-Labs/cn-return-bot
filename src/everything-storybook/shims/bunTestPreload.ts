/* Lets `bun test` load extension code. WXT's `#imports` module only exists
 * inside an extension build, so every test file gets the same in-memory
 * stand-in Storybook uses. bunfig.toml loads this file before the tests.
 *
 * The shared Supabase client refuses to load without an address, and CI has
 * none. Tests get an address where nothing listens, like Storybook does, even
 * when a local .env holds the real one, so no test can ever reach production. */
import { mock } from "bun:test";
import { browser } from "./wxtImports";

process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "test-anon-key";

mock.module("#imports", () => ({ browser }));

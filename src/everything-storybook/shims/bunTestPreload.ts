/* Lets `bun test` load extension code. WXT's `#imports` module only exists
 * inside an extension build, so every test file gets the same in-memory
 * stand-in Storybook uses. bunfig.toml loads this file before the tests. */
import { mock } from "bun:test";
import { browser } from "./wxtImports";

mock.module("#imports", () => ({ browser }));

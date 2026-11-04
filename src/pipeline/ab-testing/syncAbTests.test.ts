import { expect, test } from "bun:test";
import { abTestRows } from "./syncAbTests";
import { BOT_TEST, type ABTest } from "./abTestsData";

test("a test without a declared default has its heaviest arm as control and fills nothing", () => {
  const [row] = abTestRows([BOT_TEST]);
  expect(row).toEqual({ test: "bot", fill_variant: null, control_variant: "simple-bot", variants: ["simple-bot", "claude-code"] });
});

test("a declared default is both the fill and the control", () => {
  const gated: ABTest = {
    name: "t",
    defaultVariant: "off",
    variants: [
      { variant: { name: "on", overrides: {} }, weight: 90 },
      { variant: { name: "off", overrides: {} }, weight: 10 },
    ],
  };
  expect(abTestRows([gated])[0]).toMatchObject({ fill_variant: "off", control_variant: "off" });
});

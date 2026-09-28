import { describe, expect, test } from "bun:test";
import { cn } from "./cn";

describe("cn", () => {
  test("keeps a token colour and a text size side by side", () => {
    expect(cn("text-link", "text-sm")).toBe("text-link text-sm");
    expect(cn("text-fg-muted", "text-2xs")).toBe("text-fg-muted text-2xs");
  });

  test("lets a later class of the same kind win", () => {
    expect(cn("text-positive", "text-link")).toBe("text-link");
    expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
    expect(cn("shadow-raised", "shadow-floating")).toBe("shadow-floating");
    expect(cn("bg-surface", "bg-tint")).toBe("bg-tint");
  });

  test("drops falsy values", () => {
    expect(cn("p-3", false, null, undefined, "border")).toBe("p-3 border");
  });
});

test("keeps the display size and face apart from colours and weights", () => {
  expect(cn("text-display text-fg font-display font-bold")).toBe("text-display text-fg font-display font-bold");
  expect(cn("text-lg", "text-display")).toBe("text-display");
});

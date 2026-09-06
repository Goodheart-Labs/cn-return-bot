import { describe, expect, test } from "bun:test";
import { runABTests, withForcedPicks, resolvePicks, pickVariantName } from "./abTests";
import { AB_TESTS, PANGRAM_NOTE_TEST } from "./abTestsData";
import { buildAbTestSlots, matchesAbFilters } from "../../dashboard-shared/abFilters";

describe("retired and standalone A/B picks", () => {
  test("ordinary runs neither sample nor backfill a Pangram note label", () => {
    const { picks, config } = runABTests(AB_TESTS);
    expect(picks.pangram_note).toBeUndefined();
    expect(resolvePicks(picks).pangram_note).toBeUndefined();
    expect(resolvePicks(null).pangram_note).toBeUndefined();
    expect(picks.simple_bot_anti_pedantic).toBeUndefined();
    expect(config).not.toHaveProperty("search_anti_pedantic");
  });

  for (const variant of ["plain", "fp_context"]) {
    test(`Pangram's standalone picker still supports ${variant}`, () => {
      expect(withForcedPicks({ pangram_note: variant }, () => pickVariantName(PANGRAM_NOTE_TEST)))
        .toBe(variant);
    });
  }

  for (const variant of ["off", "on"]) {
    test(`forcing retired anti-pedantic ${variant} fails explicitly`, () => {
      expect(() => withForcedPicks(
        { bot: "simple-bot", simple_bot_anti_pedantic: variant },
        () => runABTests(AB_TESTS),
      )).toThrow('A/B test "simple_bot_anti_pedantic" is retired');
    });
  }

  test("historical labels remain readable and filterable", () => {
    const historical = { pangram_note: "fp_context", simple_bot_anti_pedantic: "off" };
    const picks = resolvePicks(historical);
    expect(picks).toMatchObject(historical);
    expect(matchesAbFilters(picks, historical)).toBe(true);
    const slots = buildAbTestSlots([{ picks }], AB_TESTS);
    for (const [name, variant] of Object.entries(historical)) {
      expect(slots.find(slot => slot.name === name)?.variants).toContain(variant);
    }
  });
});

describe("timing treatment", () => {
  for (const [variant, instruction, context] of [
    ["off", false, false],
    ["instruction", true, false],
    ["context", false, true],
  ] as const) {
    test(`${variant} remains the sole timing control`, () => {
      const { config, picks } = withForcedPicks({ timing_treatment: variant }, () => runABTests(AB_TESTS));
      expect(config.time_travel_prompt).toBe(instruction);
      expect(config.timing_context).toBe(context);
      expect(picks.timing_treatment).toBe(variant);
      expect(picks.time_travel_prompt).toBeUndefined();
    });
  }

  test("the obsolete switch fails explicitly, but historical picks survive", () => {
    for (const variant of ["on", "off"]) {
      expect(() => withForcedPicks({ time_travel_prompt: variant }, () => runABTests(AB_TESTS)))
        .toThrow('use "timing_treatment" instead');
      expect(resolvePicks({ time_travel_prompt: variant }).time_travel_prompt).toBe(variant);
    }
    expect(resolvePicks(null).time_travel_prompt).toBeUndefined();
  });
});

describe("retired correction extractor", () => {
  test("new runs have no extractor flag or synthetic off label", () => {
    const { config, picks } = runABTests(AB_TESTS);
    expect(config).not.toHaveProperty("correction_extraction");
    expect(config).not.toHaveProperty("correction_extraction_model");
    expect(resolvePicks(picks).simple_bot_correction_extraction).toBeUndefined();
  });

  test("old arms remain readable but cannot be forced", () => {
    for (const variant of ["off", "gemini3flash", "sonnet5"]) {
      const historical = { simple_bot_correction_extraction: variant };
      expect(resolvePicks(historical)).toMatchObject(historical);
      expect(matchesAbFilters(resolvePicks(historical), historical)).toBe(true);
      expect(() => withForcedPicks(historical, () => runABTests(AB_TESTS)))
        .toThrow('A/B test "simple_bot_correction_extraction" is retired');
    }
  });
});

describe("forced picks", () => {
  test("unknown tests and variants fail before starting work", () => {
    const invalidPicks: Record<string, string>[] = [
      { typo: "on" },
      { timing_treatment: "typo" },
      { timing_treatment: "" },
      { pangram_note: "typo" },
      { misinfo_concede_shape: "typo" },
    ];
    for (const picks of invalidPicks) {
      let started = false;
      expect(() => withForcedPicks(picks, () => { started = true; })).toThrow();
      expect(started).toBe(false);
    }
  });

  test("Common Notes can still force its fixed and zero-weight arms", () => {
    const forced = {
      bot: "simple-bot", note_prefilter: "off", search_claim: "on",
      simple_bot_search: "sonnet5-native", simple_bot_writer: "sonnet5",
      simple_bot_verifier: "gemini-flash", verifier_citations: "on", verifier_claim_based: "classic",
    };
    const { picks, config } = withForcedPicks(forced, () => runABTests(AB_TESTS));
    expect(picks).toMatchObject(forced);
    expect(config).toMatchObject({
      note_prefilter: false, search_claim: true,
      verifier_citations: true, verifier_claim_based: false,
    });
  });

  test("a valid topic-only override does not fire on ordinary posts", () => {
    const { picks } = withForcedPicks({ misinfo_concede_shape: "on" }, () => runABTests(AB_TESTS));
    expect(picks.misinfo_concede_shape).toBeUndefined();
  });
});

describe("writer_last_check test", () => {
  test("forced on sets writer_last_check on the config", () => {
    const { config, picks } = withForcedPicks(
      { bot: "simple-bot", writer_last_check: "on" },
      () => runABTests(AB_TESTS),
    );
    expect(picks.writer_last_check).toBe("on");
    expect(config.writer_last_check).toBe(true);
  });

  test("forced off leaves writer_last_check false", () => {
    const { config, picks } = withForcedPicks(
      { bot: "simple-bot", writer_last_check: "off" },
      () => runABTests(AB_TESTS),
    );
    expect(picks.writer_last_check).toBe("off");
    expect(config.writer_last_check).toBe(false);
  });

  test("a simple-bot run always records a pick for it", () => {
    const { picks } = withForcedPicks({ bot: "simple-bot" }, () => runABTests(AB_TESTS));
    expect(picks.writer_last_check).toMatch(/^(on|off)$/);
  });

  test("resolvePicks leaves it unset on old rows, since it has prerequisites", () => {
    expect(resolvePicks({ bot: "simple-bot" }).writer_last_check).toBeUndefined();
  });
});

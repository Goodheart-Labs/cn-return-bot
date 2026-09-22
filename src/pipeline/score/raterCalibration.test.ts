import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SupabaseLogger } from "../../api/supabaseClient";
import { DEFAULT_CALIBRATION, calibrate, loadCalibration, parseCalibration, resetCalibrationCache } from "./raterCalibration";

afterEach(() => resetCalibrationCache());

test("the built-in curves pull the rater's raw numbers down to the observed level", () => {
  expect(calibrate(0.30, DEFAULT_CALIBRATION.helpful)).toBeCloseTo(0.115, 2);
  expect(calibrate(0.50, DEFAULT_CALIBRATION.helpful)).toBeCloseTo(0.151, 2);
  expect(calibrate(0.30, DEFAULT_CALIBRATION.notHelpful)).toBeCloseTo(0.050, 2);
  // Order is kept: a higher raw number is a higher calibrated one.
  expect(calibrate(0.6, DEFAULT_CALIBRATION.helpful)).toBeGreaterThan(calibrate(0.4, DEFAULT_CALIBRATION.helpful));
});

describe("parseCalibration", () => {
  test("accepts a fit and rejects junk or a non-positive slope", () => {
    const ok = JSON.stringify({ helpful: { a: -1, b: 0.5 }, notHelpful: { a: -2, b: 0.7 }, fittedAt: "2026-09-28", notes: 900 });
    expect(parseCalibration(ok)?.fittedAt).toBe("2026-09-28");
    expect(parseCalibration("{")).toBeNull();
    expect(parseCalibration(JSON.stringify({ helpful: { a: -1, b: 0 }, notHelpful: { a: -2, b: 0.7 }, fittedAt: "x" }))).toBeNull();
    expect(parseCalibration(null)).toBeNull();
  });
});

describe("loadCalibration", () => {
  test("reads the stored fit once, and falls back to the built-in numbers", async () => {
    const getPipelineState = mock(async () => JSON.stringify({ helpful: { a: -1, b: 0.5 }, notHelpful: { a: -2, b: 0.7 }, fittedAt: "2026-09-28", notes: 900 }));
    const logger = { getPipelineState } as unknown as SupabaseLogger;
    expect((await loadCalibration(logger)).fittedAt).toBe("2026-09-28");
    await loadCalibration(logger); expect(getPipelineState).toHaveBeenCalledTimes(1);
    resetCalibrationCache();
    const broken = { getPipelineState: mock(async () => { throw new Error("db"); }) } as unknown as SupabaseLogger;
    expect(await loadCalibration(broken)).toBe(DEFAULT_CALIBRATION);
    resetCalibrationCache();
    expect(await loadCalibration(null)).toBe(DEFAULT_CALIBRATION);
  });
});

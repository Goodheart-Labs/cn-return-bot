import { expect, test } from "bun:test";
import { fitCurve } from "./refitRaterCalibration";

test("fitCurve recovers a known curve", () => {
  // Outcomes drawn deterministically from P = sigmoid(-1.5 + 0.6 x): about the shape of the real fit.
  const x: number[] = [], y: number[] = [], w: number[] = [];
  let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 4000; i++) { const xi = rand() * 6 - 3; const p = 1 / (1 + Math.exp(-(-1.5 + 0.6 * xi))); x.push(xi); y.push(rand() < p ? 1 : 0); w.push(1); }
  const c = fitCurve(x, y, w);
  expect(c.a).toBeCloseTo(-1.5, 0); expect(c.b).toBeCloseTo(0.6, 0);
});

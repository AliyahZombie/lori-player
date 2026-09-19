import { expect, it } from "vitest";
import { dominantHue } from "./theme";
it("extracts blue without being dominated by white borders", () => {
  expect(
    dominantHue(
      new Uint8ClampedArray([
        255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 255,
      ]),
    ),
  ).toBeCloseTo(240);
});
it("falls back to blue for monochrome or transparent covers", () => {
  expect(dominantHue(new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 0]))).toBe(
    215,
  );
});
it("handles red hue wraparound", () => {
  const hue = dominantHue(new Uint8ClampedArray([255, 0, 0, 255]));
  expect(Math.min(hue, 360 - hue)).toBeLessThan(1);
});

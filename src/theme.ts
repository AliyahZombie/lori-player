export type ThemeMode = "blue" | "cover" | "wallpaper";
// Weight colorful midtones so white borders and dark backgrounds don't dominate.
export function dominantHue(pixels: Uint8ClampedArray): number {
  const bins = Array.from({ length: 36 }, () => ({ weight: 0, x: 0, y: 0 }));
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i] / 255,
      g = pixels[i + 1] / 255,
      b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    if (delta < 0.08 || max < 0.15 || min > 0.9) continue;
    let hue =
      (max === r
        ? (g - b) / delta + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4) * 60;
    const weight = delta * (1 - Math.abs((max + min) / 2 - 0.5));
    const bin = bins[Math.floor(hue / 10) % 36];
    bin.weight += weight;
    bin.x += Math.cos((hue * Math.PI) / 180) * weight;
    bin.y += Math.sin((hue * Math.PI) / 180) * weight;
  }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  return best.weight
    ? ((Math.atan2(best.y, best.x) * 180) / Math.PI + 360) % 360
    : 215;
}
export async function imageHue(source: string): Promise<number> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 215;
  context.drawImage(image, 0, 0, 64, 64);
  return dominantHue(context.getImageData(0, 0, 64, 64).data);
}

/**
 * @file packages/capability-runtime/src/audit/visual-compare.ts
 * @description Pixel-level visual regression comparison between two screenshots — real
 * Sutradhar's `sutradhar compare <url1> <url2> --fail-on-diff`. Built on `pixelmatch` (pure
 * pixel-diff algorithm) + `pngjs` (PNG encode/decode) — small, dependency-free/near-dependency-
 * free libraries doing exactly this one job, rather than hand-rolling PNG parsing.
 */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface VisualCompareResult {
  readonly width: number;
  readonly height: number;
  readonly diffPixelCount: number;
  readonly totalPixels: number;
  readonly diffPercentage: number;
  /** Base64 PNG highlighting the differing pixels in red (anti-aliased-only differences in
   *  yellow), same dimensions as the two inputs. */
  readonly diffImageBase64: string;
}

/**
 * Compares two same-dimension PNG screenshots (base64, no data-URI prefix) pixel-by-pixel.
 * Throws if their dimensions differ — a size mismatch (different viewport, different
 * fullPage/viewport-only capture) makes a pixel-by-pixel diff meaningless; the caller should
 * ensure both screenshots were taken with the same viewport/capture mode.
 */
export function compareScreenshots(
  base64A: string,
  base64B: string,
  options: { threshold?: number } = {},
): VisualCompareResult {
  const imgA = PNG.sync.read(Buffer.from(base64A, 'base64'));
  const imgB = PNG.sync.read(Buffer.from(base64B, 'base64'));

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `Cannot compare screenshots of different dimensions (${imgA.width}x${imgA.height} vs ` +
        `${imgB.width}x${imgB.height}) — capture both with the same viewport and fullPage setting.`,
    );
  }

  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  const diffPixelCount = pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
  });
  const totalPixels = width * height;

  return {
    width,
    height,
    diffPixelCount,
    totalPixels,
    diffPercentage: totalPixels > 0 ? (diffPixelCount / totalPixels) * 100 : 0,
    diffImageBase64: PNG.sync.write(diff).toString('base64'),
  };
}

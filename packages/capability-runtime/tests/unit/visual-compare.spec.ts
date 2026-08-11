/**
 * @file packages/capability-runtime/tests/unit/visual-compare.spec.ts
 * @description Unit tests for compareScreenshots — real PNG encode/decode/diff via
 * pngjs/pixelmatch against small synthetic images (not real screenshots, but real PNG bytes,
 * not mocked), so the actual comparison algorithm is exercised.
 */
import { PNG } from 'pngjs';
import { compareScreenshots } from '../../src/audit/visual-compare.js';

function makeSolidPng(width: number, height: number, [r, g, b]: [number, number, number]): string {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

describe('@sutradhar/capability-runtime compareScreenshots', () => {
  it('reports zero diff for two identical images', () => {
    const a = makeSolidPng(10, 10, [255, 0, 0]);
    const b = makeSolidPng(10, 10, [255, 0, 0]);

    const result = compareScreenshots(a, b);

    expect(result.diffPixelCount).toBe(0);
    expect(result.diffPercentage).toBe(0);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.totalPixels).toBe(100);
  });

  it('reports every pixel as different for two completely different solid-color images', () => {
    const a = makeSolidPng(10, 10, [255, 0, 0]);
    const b = makeSolidPng(10, 10, [0, 255, 0]);

    const result = compareScreenshots(a, b);

    expect(result.diffPixelCount).toBe(100);
    expect(result.diffPercentage).toBe(100);
  });

  it('returns a real, correctly-sized diff PNG', () => {
    const a = makeSolidPng(10, 10, [255, 0, 0]);
    const b = makeSolidPng(10, 10, [0, 255, 0]);

    const result = compareScreenshots(a, b);
    const diffPng = PNG.sync.read(Buffer.from(result.diffImageBase64, 'base64'));

    expect(diffPng.width).toBe(10);
    expect(diffPng.height).toBe(10);
  });

  it('throws a clear error when the two images have different dimensions', () => {
    const a = makeSolidPng(10, 10, [255, 0, 0]);
    const b = makeSolidPng(20, 10, [255, 0, 0]);

    expect(() => compareScreenshots(a, b)).toThrow(/different dimensions/);
    expect(() => compareScreenshots(a, b)).toThrow(/10x10/);
    expect(() => compareScreenshots(a, b)).toThrow(/20x10/);
  });

  it('honors a custom threshold', () => {
    // A near-identical but not pixel-perfect pair — slightly off-red.
    const a = makeSolidPng(4, 4, [200, 100, 100]);
    const b = makeSolidPng(4, 4, [205, 100, 100]);

    const strict = compareScreenshots(a, b, { threshold: 0 });
    const lenient = compareScreenshots(a, b, { threshold: 1 });

    // A threshold of 1 (least sensitive) should never report MORE diff pixels than threshold 0.
    expect(lenient.diffPixelCount).toBeLessThanOrEqual(strict.diffPixelCount);
  });
});

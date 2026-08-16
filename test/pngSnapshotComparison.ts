import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface PngCompareBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PngComparison {
  matches: boolean;
  numDiffPixels?: number;
  diffBuffer?: Buffer;
  expectedSize: { width: number; height: number };
  actualSize: { width: number; height: number };
}

export function comparePngBuffers(
  expectedBuffer: Buffer,
  actualBuffer: Buffer,
  maxDiffPixels: number,
  threshold: number,
  compareBox?: PngCompareBox | null
): PngComparison {
  const expectedImage = PNG.sync.read(expectedBuffer);
  const actualImage = PNG.sync.read(actualBuffer);
  const expectedForCompare = compareBox ? cropPng(expectedImage, compareBox) : expectedImage;
  const actualForCompare = compareBox ? cropPng(actualImage, compareBox) : actualImage;
  const expectedSize = { width: expectedForCompare.width, height: expectedForCompare.height };
  const actualSize = { width: actualForCompare.width, height: actualForCompare.height };

  if (expectedSize.width !== actualSize.width || expectedSize.height !== actualSize.height) {
    return { matches: false, expectedSize, actualSize };
  }

  const diff = new PNG(expectedSize);
  const numDiffPixels = pixelmatch(
    expectedForCompare.data,
    actualForCompare.data,
    diff.data,
    expectedSize.width,
    expectedSize.height,
    { threshold }
  );
  return {
    matches: numDiffPixels <= maxDiffPixels,
    numDiffPixels,
    diffBuffer: PNG.sync.write(diff),
    expectedSize,
    actualSize,
  };
}

function cropPng(source: PNG, box: PngCompareBox): PNG {
  const x = Math.max(0, Math.min(source.width - 1, box.x));
  const y = Math.max(0, Math.min(source.height - 1, box.y));
  const width = Math.max(1, Math.min(source.width - x, box.width));
  const height = Math.max(1, Math.min(source.height - y, box.height));
  const cropped = new PNG({ width, height });

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    source.data.copy(cropped.data, targetStart, sourceStart, sourceEnd);
  }

  return cropped;
}

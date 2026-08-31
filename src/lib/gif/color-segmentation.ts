/**
 * Color-based segmentation and region movement.
 * Groups connected pixels by color similarity, then moves entire
 * color regions as solid shapes — no pixel-level shattering.
 *
 * Example: a purple line moves as one piece, a red moon silhouette
 * slides to a new position intact.
 */

import type { Frame } from './types';
import { mulberry32 } from '../utils/noise';

interface ColorRegion {
  pixels: number[]; // flat list of pixel indices (y * width + x)
  avgR: number;
  avgG: number;
  avgB: number;
  centerX: number;
  centerY: number;
}

/**
 * Segment a frame into connected color regions using flood-fill.
 * `threshold` controls how similar colors must be to merge (0-120).
 * Lower = stricter (more, smaller regions).
 * Higher = looser (fewer, bigger regions).
 */
function segmentByColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): ColorRegion[] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const regions: ColorRegion[] = [];
  const t2 = threshold * threshold; // compare squared distance to avoid sqrt

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startIdx = startY * width + startX;
      if (visited[startIdx]) continue;

      const si = startIdx * 4;
      const sr = rgba[si];
      const sg = rgba[si + 1];
      const sb = rgba[si + 2];
      const sa = rgba[si + 3];

      if (sa < 10) {
        visited[startIdx] = 1;
        continue;
      }

      // Flood fill
      const pixels: number[] = [];
      let sumR = 0, sumG = 0, sumB = 0, sumX = 0, sumY = 0;
      const stack: number[] = [startIdx]; // store flat index

      while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx]) continue;

        const pi = idx * 4;
        const pr = rgba[pi];
        const pg = rgba[pi + 1];
        const pb = rgba[pi + 2];
        const pa = rgba[pi + 3];

        if (pa < 10) {
          visited[idx] = 1;
          continue;
        }

        const dr = pr - sr;
        const dg = pg - sg;
        const db = pb - sb;
        if (dr * dr + dg * dg + db * db > t2) continue;

        visited[idx] = 1;
        pixels.push(idx);
        sumR += pr;
        sumG += pg;
        sumB += pb;
        const px = idx % width;
        const py = (idx - px) / width;
        sumX += px;
        sumY += py;

        // Push 4-connected neighbors
        const x = idx % width;
        const y = (idx - x) / width;
        if (x > 0) stack.push(idx - 1);
        if (x < width - 1) stack.push(idx + 1);
        if (y > 0) stack.push(idx - width);
        if (y < height - 1) stack.push(idx + width);
      }

      // Only keep regions with meaningful size
      if (pixels.length >= 8) {
        const n = pixels.length;
        regions.push({
          pixels,
          avgR: sumR / n,
          avgG: sumG / n,
          avgB: sumB / n,
          centerX: sumX / n,
          centerY: sumY / n,
        });
      }
    }
  }

  return regions;
}

/**
 * Move entire color regions to new positions.
 * Each region slides as a solid block — no internal distortion.
 *
 * @param strength  0-100, how far regions move
 * @param seed      deterministic seed for this variation
 * @param threshold color similarity threshold (10-80)
 */
export function moveColorRegions(
  frame: Frame,
  strength: number,
  seed: number,
  threshold: number = 30
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src); // start as copy of original
  const k = Math.max(0, Math.min(100, strength)) / 100;

  if (k <= 0) return out;

  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const regions = segmentByColor(src, width, height, threshold);

  // Sort regions by size descending so large regions are placed first
  regions.sort((a, b) => b.pixels.length - a.pixels.length);

  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(2, Math.round(k * maxDim * 0.35));

  // Track which output pixels have been written to
  const written = new Uint8Array(width * height);

  for (const region of regions) {
    const dx = Math.round((rand() * 2 - 1) * moveRadius);
    const dy = Math.round((rand() * 2 - 1) * moveRadius);

    for (const idx of region.pixels) {
      const ox = idx % width;
      const oy = (idx - ox) / width;

      const nx = ((ox + dx) % width + width) % width;
      const ny = ((oy + dy) % height + height) % height;
      const ni = ny * width + nx;

      if (!written[ni]) {
        const si = idx * 4;
        const di = ni * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
        written[ni] = 1;
      }
    }
  }

  return out;
}

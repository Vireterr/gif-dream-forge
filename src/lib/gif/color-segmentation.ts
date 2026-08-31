/**
 * Color-based segmentation via PALETTE QUANTIZATION.
 *
 * Algorithm:
 * 1. Extract dominant colors from the frame (simple k-means)
 * 2. Assign every pixel to its nearest palette color
 * 3. Group ALL pixels of the same palette color into ONE region
 * 4. Move each region as a solid unit
 *
 * This way, a red moon (even if scattered) moves as ONE piece.
 * A purple line moves as ONE piece. No noise, no shattering.
 */

import type { Frame } from './types';
import { mulberry32 } from '../utils/noise';

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Build a color palette from the frame using simple k-means.
 * `numColors` = how many dominant colors to extract (8-16 is good).
 */
function buildPalette(
  rgba: Uint8ClampedArray,
  numColors: number
): PaletteColor[] {
  // Sample pixels (skip transparent, sample every Nth for speed)
  const samples: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(rgba.length / 4 / 4000));
  for (let i = 0; i < rgba.length; i += 4 * step) {
    const a = rgba[i + 3];
    if (a < 30) continue;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (samples.length === 0) return [];

  // Initialize centroids with evenly spaced samples
  const centroids: Array<[number, number, number]> = [];
  const stride = Math.max(1, Math.floor(samples.length / numColors));
  for (let i = 0; i < numColors && i * stride < samples.length; i++) {
    centroids.push([...samples[i * stride]]);
  }

  // K-means iterations
  const assignments = new Int32Array(samples.length);
  for (let iter = 0; iter < 8; iter++) {
    // Assign
    for (let s = 0; s < samples.length; s++) {
      const [sr, sg, sb] = samples[s];
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const [cr, cg, cb] = centroids[c];
        const dr = sr - cr;
        const dg = sg - cg;
        const db = sb - cb;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assignments[s] = best;
    }

    // Update centroids
    const sums = centroids.map(() => [0, 0, 0, 0] as [number, number, number, number]);
    for (let s = 0; s < samples.length; s++) {
      const c = assignments[s];
      sums[c][0] += samples[s][0];
      sums[c][1] += samples[s][1];
      sums[c][2] += samples[s][2];
      sums[c][3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      const n = sums[c][3];
      if (n > 0) {
        centroids[c] = [sums[c][0] / n, sums[c][1] / n, sums[c][2] / n];
      }
    }
  }

  return centroids.map(([r, g, b]) => ({
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
  }));
}

/**
 * Assign each pixel to its nearest palette color.
 * Returns an array of palette indices (one per pixel).
 * Transparent pixels get index -1.
 */
function assignPixelsToPalette(
  rgba: Uint8ClampedArray,
  palette: PaletteColor[]
): Int16Array {
  const numPixels = rgba.length / 4;
  const assignments = new Int16Array(numPixels);

  for (let i = 0; i < numPixels; i++) {
    const pi = i * 4;
    const r = rgba[pi];
    const g = rgba[pi + 1];
    const b = rgba[pi + 2];
    const a = rgba[pi + 3];

    if (a < 30) {
      assignments[i] = -1;
      continue;
    }

    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const p = palette[c];
      const dr = r - p.r;
      const dg = g - p.g;
      const db = b - p.b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    assignments[i] = best;
  }

  return assignments;
}

/**
 * Move color regions (defined by palette) as solid units.
 *
 * @param strength    0-100, how far regions move
 * @param seed        deterministic seed
 * @param numColors   number of palette colors (8-24, default 12)
 */
export function moveColorRegions(
  frame: Frame,
  strength: number,
  seed: number,
  numColors: number = 12
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const totalPixels = width * height;

  if (k <= 0) return new Uint8ClampedArray(src);

  // 1. Build palette
  const palette = buildPalette(src, numColors);
  if (palette.length === 0) return new Uint8ClampedArray(src);

  // 2. Assign every pixel to palette
  const assignments = assignPixelsToPalette(src, palette);

  // 3. Group pixels by palette color
  const groups: number[][] = palette.map(() => []);
  for (let i = 0; i < totalPixels; i++) {
    const c = assignments[i];
    if (c >= 0) groups[c].push(i);
  }

  // 4. Generate movement for each group
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(4, Math.round(k * maxDim * 0.45));

  const movements = groups.map((group) => {
    if (group.length < 20) {
      // Tiny groups don't move (noise pixels)
      return { dx: 0, dy: 0 };
    }
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * moveRadius;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
    };
  });

  // 5. Build output: start transparent, then place each group at new position
  const out = new Uint8ClampedArray(totalPixels * 4);
  const written = new Uint8Array(totalPixels);

  // Sort groups by size descending (large regions first, they win collisions)
  const sortedIndices = groups
    .map((g, i) => i)
    .sort((a, b) => groups[b].length - groups[a].length);

  for (const gi of sortedIndices) {
    const group = groups[gi];
    const { dx, dy } = movements[gi];

    for (const idx of group) {
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

  // 6. Fill unwritten pixels with original (background preservation)
  for (let i = 0; i < totalPixels; i++) {
    if (!written[i]) {
      const si = i * 4;
      const di = i * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }

  return out;
}

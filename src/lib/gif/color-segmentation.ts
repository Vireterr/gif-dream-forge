/**
 * Color-based segmentation with MULTIPLE TARGET COLORS.
 *
 * Modes:
 * 1. Move ALL color regions (palette-based)
 * 2. Move ONLY pixels of specific target colors (multiple colors supported)
 */

import type { Frame, TargetColor } from './types';
import { mulberry32 } from '../utils/noise';

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

function buildPalette(
  rgba: Uint8ClampedArray,
  numColors: number
): PaletteColor[] {
  const samples: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(rgba.length / 4 / 4000));
  for (let i = 0; i < rgba.length; i += 4 * step) {
    const a = rgba[i + 3];
    if (a < 30) continue;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (samples.length === 0) return [];

  const centroids: Array<[number, number, number]> = [];
  const stride = Math.max(1, Math.floor(samples.length / numColors));
  for (let i = 0; i < numColors && i * stride < samples.length; i++) {
    centroids.push([...samples[i * stride]]);
  }

  const assignments = new Int32Array(samples.length);
  for (let iter = 0; iter < 8; iter++) {
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

function matchesTargetColor(
  r: number,
  g: number,
  b: number,
  target: TargetColor
): boolean {
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const maxDist = 441;
  const threshold = (target.tolerance / 100) * maxDist;
  return dist <= threshold;
}

/**
 * Move ONLY pixels matching ANY of the target colors.
 * Each target color moves as ONE solid shape in its own direction.
 */
export function moveTargetColors(
  frame: Frame,
  strength: number,
  seed: number,
  targets: TargetColor[]
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const totalPixels = width * height;

  if (k <= 0 || targets.length === 0) return new Uint8ClampedArray(src);

  // 1. Group pixels by which target color they match
  const groups: number[][] = targets.map(() => []);
  for (let i = 0; i < totalPixels; i++) {
    const pi = i * 4;
    const r = src[pi];
    const g = src[pi + 1];
    const b = src[pi + 2];
    const a = src[pi + 3];
    if (a < 30) continue;

    for (let t = 0; t < targets.length; t++) {
      if (matchesTargetColor(r, g, b, targets[t])) {
        groups[t].push(i);
        break; // pixel belongs to first matching target only
      }
    }
  }

  // 2. Generate movement for each target color
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(4, Math.round(k * maxDim * 0.5));

  const movements = targets.map((_, t) => {
    if (groups[t].length < 10) return { dx: 0, dy: 0 };
    const angle = rand() * Math.PI * 2;
    const dist = (0.4 + rand() * 0.6) * moveRadius;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
    };
  });

  // 3. Build output: start with original, clear target pixels, place at new positions
  const out = new Uint8ClampedArray(src);
  const written = new Uint8Array(totalPixels);

  // Clear old positions of all target pixels
  for (const group of groups) {
    for (const idx of group) {
      const di = idx * 4;
      out[di] = 0;
      out[di + 1] = 0;
      out[di + 2] = 0;
      out[di + 3] = 0;
    }
  }

  // Place each group at its new position (larger groups first)
  const sortedIndices = groups
    .map((g, i) => i)
    .sort((a, b) => groups[b].length - groups[a].length);

  for (const t of sortedIndices) {
    const group = groups[t];
    const { dx, dy } = movements[t];

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

  return out;
}

/**
 * Move ALL color regions (palette-based).
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

  const palette = buildPalette(src, numColors);
  if (palette.length === 0) return new Uint8ClampedArray(src);

  const assignments = new Int16Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const pi = i * 4;
    const r = src[pi];
    const g = src[pi + 1];
    const b = src[pi + 2];
    const a = src[pi + 3];

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

  const groups: number[][] = palette.map(() => []);
  for (let i = 0; i < totalPixels; i++) {
    const c = assignments[i];
    if (c >= 0) groups[c].push(i);
  }

  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(4, Math.round(k * maxDim * 0.45));

  const movements = groups.map((group) => {
    if (group.length < 20) return { dx: 0, dy: 0 };
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * moveRadius;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
    };
  });

  const out = new Uint8ClampedArray(totalPixels * 4);
  const written = new Uint8Array(totalPixels);

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

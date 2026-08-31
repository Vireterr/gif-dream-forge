/**
 * Color-based collage: selected colors are cut out as solid shapes
 * and moved to new positions. Background fills old positions with
 * average neighbor color. Stable across all frames.
 */

import type { Frame, TargetColor } from './types';
import { mulberry32 } from '../utils/noise';

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
 * Get average color of non-target neighbors (for background fill).
 */
function getAverageBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  isTarget: (r: number, g: number, b: number) => boolean
): { r: number; g: number; b: number; a: number } {
  let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = (ny * width + nx) * 4;
      const nr = rgba[ni];
      const ng = rgba[ni + 1];
      const nb = rgba[ni + 2];
      const na = rgba[ni + 3];
      if (!isTarget(nr, ng, nb)) {
        sumR += nr;
        sumG += ng;
        sumB += nb;
        sumA += na;
        count++;
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
    a: Math.round(sumA / count),
  };
}

/**
 * Apply color collage: cut out target colors and move them.
 * Uses SAME movement for all frames (stable).
 */
export function applyColorCollage(
  frame: Frame,
  strength: number,
  seed: number,
  targets: TargetColor[]
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const totalPixels = width * height;

  if (k <= 0 || targets.length === 0) return new Uint8ClampedArray(src);

  const enabledTargets = targets.filter((t) => t.enabled);
  if (enabledTargets.length === 0) return new Uint8ClampedArray(src);

  // Generate movement for each target (SAME for all frames)
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const maxDim = Math.max(width, height);
  const moveRadius = Math.max(4, Math.round(k * maxDim * 0.4));

  const movements = enabledTargets.map(() => {
    const angle = rand() * Math.PI * 2;
    const dist = (0.4 + rand() * 0.6) * moveRadius;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
    };
  });

  // Build output
  const out = new Uint8ClampedArray(src);

  // For each target, find pixels and move them
  for (let t = 0; t < enabledTargets.length; t++) {
    const target = enabledTargets[t];
    const { dx, dy } = movements[t];

    const isTarget = (r: number, g: number, b: number) =>
      matchesTargetColor(r, g, b, target);

    // Find all pixels of this color
    const pixels: number[] = [];
    for (let i = 0; i < totalPixels; i++) {
      const pi = i * 4;
      const r = src[pi];
      const g = src[pi + 1];
      const b = src[pi + 2];
      const a = src[pi + 3];
      if (a < 30) continue;
      if (isTarget(r, g, b)) {
        pixels.push(i);
      }
    }

    if (pixels.length === 0) continue;

    // Fill old positions with background color
    for (const idx of pixels) {
      const x = idx % width;
      const y = (idx - x) / width;
      const bg = getAverageBackground(src, width, height, x, y, 5, isTarget);
      const di = idx * 4;
      out[di] = bg.r;
      out[di + 1] = bg.g;
      out[di + 2] = bg.b;
      out[di + 3] = bg.a;
    }

    // Place at new position
    for (const idx of pixels) {
      const ox = idx % width;
      const oy = (idx - ox) / width;
      const nx = ((ox + dx) % width + width) % width;
      const ny = ((oy + dy) % height + height) % height;
      const ni = ny * width + nx;
      const si = idx * 4;
      const di = ni * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }

  return out;
}

/**
 * Legacy function for backward compatibility.
 */
export function moveTargetColors(
  frame: Frame,
  strength: number,
  seed: number,
  targets: TargetColor[],
  _pixelSize: number = 1
): Uint8ClampedArray {
  return applyColorCollage(frame, strength, seed, targets);
}

export function moveColorRegions(
  frame: Frame,
  strength: number,
  seed: number,
  _numColors: number = 12,
  _pixelSize: number = 1
): Uint8ClampedArray {
  return new Uint8ClampedArray(frame.rgba);
}

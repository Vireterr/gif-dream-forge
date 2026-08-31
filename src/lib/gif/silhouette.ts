/**
 * Silhouette / contour preservation.
 *
 * Builds a mask of the drawing's structural edges (alpha border + luminance
 * gradient) and blends distorted pixels back toward the original there, so the
 * overall shape stays readable while the interior can be freely reworked.
 */

import type { Frame, MotionMask } from './types';

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Compute a 0-255 silhouette mask: high where contours/edges live.
 */
export function computeSilhouetteMask(frame: Frame): MotionMask {
  const { rgba, width, height } = frame;
  const raw = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = luma(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
      const a = rgba[i + 3] ?? 255;

      const xr = Math.min(width - 1, x + 1);
      const yd = Math.min(height - 1, y + 1);
      const ir = (y * width + xr) * 4;
      const id = (yd * width + x) * 4;

      const lr = luma(rgba[ir] ?? 0, rgba[ir + 1] ?? 0, rgba[ir + 2] ?? 0);
      const ld = luma(rgba[id] ?? 0, rgba[id + 1] ?? 0, rgba[id + 2] ?? 0);

      const ar = rgba[ir + 3] ?? 255;
      const ad = rgba[id + 3] ?? 255;

      const gradient = Math.abs(l - lr) + Math.abs(l - ld);
      const alphaEdge = Math.abs(a - ar) + Math.abs(a - ad);

      raw[y * width + x] = Math.min(255, gradient * 1.6 + alphaEdge);
    }
  }

  // Dilate + blur so the protected band covers a few pixels around contours.
  const data = new Uint8Array(width * height);
  const r = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let peak = 0;
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const v = raw[ny * width + nx] ?? 0;
          if (v > peak) peak = v;
          sum += v;
          n++;
        }
      }
      const avg = n > 0 ? sum / n : 0;
      data[y * width + x] = Math.round(Math.min(255, peak * 0.6 + avg * 0.8));
    }
  }

  return { data, width, height };
}

/**
 * Blend the transformed frame back toward the original where the silhouette
 * mask is strong. `strength` 0-100: 0 = free deformation, 100 = contour locked.
 */
export function preserveSilhouette(
  transformed: Uint8ClampedArray,
  original: Uint8ClampedArray,
  mask: Uint8Array,
  strength: number
): Uint8ClampedArray {
  if (strength <= 0) return transformed;
  const k = Math.min(100, strength) / 100;
  const out = new Uint8ClampedArray(transformed.length);

  for (let p = 0; p < mask.length; p++) {
    const w = ((mask[p] ?? 0) / 255) * k;
    const i = p * 4;
    for (let c = 0; c < 4; c++) {
      const t = transformed[i + c] ?? 0;
      const o = original[i + c] ?? 0;
      out[i + c] = t + (o - t) * w;
    }
  }

  return out;
}

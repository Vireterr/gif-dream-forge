/**
 * Re-assembly stage: rebuilds the picture inside the GIF out of its own
 * material — either block by block or (with a tiny block size) almost pixel by
 * pixel. The mapping is generated once per variation and reused for every
 * frame, so the animation stays coherent instead of flickering.
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

/**
 * Build a deterministic block mapping.
 * @param blockSize  tile size in pixels (1-2 = near pixel-level scatter)
 * @param strength   0-100, how many tiles move and how far
 */
export function generateReassemblyMap(
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number
): ReassemblyMap {
  const size = Math.max(1, Math.round(blockSize));
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const total = cols * rows;

  const offsetX = new Int16Array(total);
  const offsetY = new Int16Array(total);
  const flags = new Uint8Array(total); // bit0 = flip X, bit1 = flip Y

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

  // Move radius shrinks with tile size so fine grids stay legible.
  const radius = Math.max(1, Math.round(k * Math.max(2, Math.min(cols, rows) * 0.18)));
  const moveChance = k * 0.85;

  for (let i = 0; i < total; i++) {
    if (rand() < moveChance) {
      offsetX[i] = Math.round((rand() * 2 - 1) * radius);
      offsetY[i] = Math.round((rand() * 2 - 1) * radius);
      let f = 0;
      if (k > 0.5 && rand() > 0.75) f |= 1;
      if (k > 0.7 && rand() > 0.85) f |= 2;
      flags[i] = f;
    }
  }

  return { blockSize: size, cols, rows, offsetX, offsetY, flags };
}

/**
 * Apply the reassembly map to a frame. Tiles are pulled from a shifted source
 * location; where the silhouette mask is strong the shift is damped so the
 * main contour does not fall apart.
 */
export function applyReassemblyToFrame(
  frame: Frame,
  map: ReassemblyMap,
  silhouetteMask?: Uint8Array,
  silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  const { blockSize: size, cols, rows, offsetX, offsetY, flags } = map;
  const guard = Math.max(0, Math.min(100, silhouetteStrength)) / 100;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      let ox = offsetX[bi] ?? 0;
      let oy = offsetY[bi] ?? 0;
      const flag = flags[bi] ?? 0;

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);

      // Damp the shift on contour-heavy tiles
      if (silhouetteMask && guard > 0) {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            sum += silhouetteMask[y * width + x] ?? 0;
            n++;
          }
        }
        const edge = n > 0 ? sum / n / 255 : 0;
        const damp = 1 - Math.min(1, edge * guard * 1.4);
        ox = Math.round(ox * damp);
        oy = Math.round(oy * damp);
      }

      const sxBase = (bx + ox) * size;
      const syBase = (by + oy) * size;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const lx = x - x0;
          const ly = y - y0;
          const fx = flag & 1 ? size - 1 - lx : lx;
          const fy = flag & 2 ? size - 1 - ly : ly;

          let sx = sxBase + fx;
          let sy = syBase + fy;

          // Wrap inside the canvas so nothing is lost
          sx = ((sx % width) + width) % width;
          sy = ((sy % height) + height) % height;

          const di = (y * width + x) * 4;
          const si = (sy * width + sx) * 4;
          out[di] = src[si] ?? 0;
          out[di + 1] = src[si + 1] ?? 0;
          out[di + 2] = src[si + 2] ?? 0;
          out[di + 3] = src[si + 3] ?? 255;
        }
      }
    }
  }

  return out;
}

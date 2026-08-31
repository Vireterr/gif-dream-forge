/**
 * Reassembly: splits image into blocks and moves each block.
 * No modes — simple block displacement.
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

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
  const flags = new Uint8Array(total);

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

  const maxDim = Math.max(cols, rows);
  const radius = Math.max(1, Math.round(k * maxDim * 0.6));
  const moveChance = 0.8 + k * 0.2;

  for (let i = 0; i < total; i++) {
    if (rand() < moveChance) {
      const angle = rand() * Math.PI * 2;
      const dist = (0.3 + rand() * 0.7) * radius;
      offsetX[i] = Math.round(Math.cos(angle) * dist);
      offsetY[i] = Math.round(Math.sin(angle) * dist);

      let f = 0;
      if (k > 0.5 && rand() > 0.85) f |= 1;
      if (k > 0.6 && rand() > 0.9) f |= 2;
      flags[i] = f;
    }
  }

  return { blockSize: size, cols, rows, offsetX, offsetY, flags };
}

export function applyReassemblyToFrame(
  frame: Frame,
  map: ReassemblyMap,
  _silhouetteMask?: Uint8Array,
  _silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  const { blockSize: size, cols, rows, offsetX, offsetY, flags } = map;

  out.set(src);
  const written = new Uint8Array(width * height);

  // Clear old positions
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      const ox = offsetX[bi] ?? 0;
      const oy = offsetY[bi] ?? 0;

      if (ox === 0 && oy === 0) continue;

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const di = (y * width + x) * 4;
          out[di] = 0;
          out[di + 1] = 0;
          out[di + 2] = 0;
          out[di + 3] = 0;
        }
      }
    }
  }

  // Place blocks at new positions
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      const ox = offsetX[bi] ?? 0;
      const oy = offsetY[bi] ?? 0;
      const flag = flags[bi] ?? 0;

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);

      const nx0 = ((x0 + ox * size) % width + width) % width;
      const ny0 = ((y0 + oy * size) % height + height) % height;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const lx = x - x0;
          const ly = y - y0;

          const fx = flag & 1 ? size - 1 - lx : lx;
          const fy = flag & 2 ? size - 1 - ly : ly;

          const sx = x0 + fx;
          const sy = y0 + fy;

          const dx = ((nx0 + lx) % width + width) % width;
          const dy = ((ny0 + ly) % height + height) % height;

          const si = (sy * width + sx) * 4;
          const di = (dy * width + dx) * 4;

          if (!written[dy * width + dx]) {
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
            written[dy * width + dx] = 1;
          }
        }
      }
    }
  }

  // Fill empty pixels with original
  for (let i = 0; i < width * height; i++) {
    if (!written[i]) {
      const di = i * 4;
      if (out[di + 3] === 0 && src[di + 3] > 0) {
        out[di] = src[di];
        out[di + 1] = src[di + 1];
        out[di + 2] = src[di + 2];
        out[di + 3] = src[di + 3];
      }
    }
  }

  return out;
}

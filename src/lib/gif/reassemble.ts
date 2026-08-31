/**
 * Re-assembly stage: rebuilds the picture inside the GIF out of its own
 * material. Multiple modes available:
 * - scatter: blocks fly to random positions
 * - flow: blocks move along a noise field (organic)
 * - swap: blocks exchange positions with neighbors
 * - vortex: blocks spiral toward/away from center
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

export type ReassemblyMode = 'scatter' | 'flow' | 'swap' | 'vortex';

/**
 * Build a deterministic block mapping with multiple modes.
 */
export function generateReassemblyMap(
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number,
  mode: ReassemblyMode = 'scatter'
): ReassemblyMap {
  const size = Math.max(1, Math.round(blockSize));
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const total = cols * rows;

  const offsetX = new Int16Array(total);
  const offsetY = new Int16Array(total);
  const flags = new Uint8Array(total); // bit0 = flip X, bit1 = flip Y, bit2 = rotate 90°

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

  const maxDim = Math.max(cols, rows);
  const radius = Math.max(2, Math.round(k * maxDim * 0.5));
  const moveChance = 0.85 + k * 0.15;

  for (let i = 0; i < total; i++) {
    const bx = i % cols;
    const by = Math.floor(i / cols);

    if (rand() < moveChance) {
      let ox = 0;
      let oy = 0;

      switch (mode) {
        case 'scatter':
          ox = Math.round((rand() * 2 - 1) * radius);
          oy = Math.round((rand() * 2 - 1) * radius);
          break;

        case 'flow': {
          const angle = (bx / cols + by / rows) * Math.PI * 4 + rand() * 0.5;
          const dist = radius * (0.3 + rand() * 0.7);
          ox = Math.round(Math.cos(angle) * dist);
          oy = Math.round(Math.sin(angle) * dist);
          break;
        }

        case 'swap': {
          const dir = Math.floor(rand() * 4);
          const swapDist = Math.max(1, Math.round(k * 8));
          if (dir === 0) ox = swapDist;
          else if (dir === 1) ox = -swapDist;
          else if (dir === 2) oy = swapDist;
          else oy = -swapDist;
          break;
        }

        case 'vortex': {
          const cx = cols / 2;
          const cy = rows / 2;
          const dx = bx - cx;
          const dy = by - cy;
          const spiralAngle = Math.atan2(dy, dx) + k * Math.PI * 2;
          const spiralDist = radius * 0.4;
          ox = Math.round(Math.cos(spiralAngle) * spiralDist - dx * k * 0.3);
          oy = Math.round(Math.sin(spiralAngle) * spiralDist - dy * k * 0.3);
          break;
        }
      }

      offsetX[i] = ox;
      offsetY[i] = oy;

      let f = 0;
      if (k > 0.4 && rand() > 0.7) f |= 1;
      if (k > 0.5 && rand() > 0.8) f |= 2;
      if (k > 0.6 && rand() > 0.85) f |= 4;
      flags[i] = f;
    }
  }

  return { blockSize: size, cols, rows, offsetX, offsetY, flags };
}

/**
 * Apply the reassembly map to a frame.
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
  const guard = Math.max(0, Math.min(100, silhouetteStrength)) / 100 * 0.3;

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

      if (silhouetteMask && guard > 0) {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            sum += silhouetteMask[y * width + x] ?? 0;
            n++;
          }
        }
        const edge = n > 0 ? sum / n / 255 : 0;
        const damp = 1 - Math.min(1, edge * guard);
        ox = Math.round(ox * damp);
        oy = Math.round(oy * damp);
      }

      const sxBase = (bx + ox) * size;
      const syBase = (by + oy) * size;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          let lx = x - x0;
          let ly = y - y0;

          if (flag & 4) {
            const tmp = lx;
            lx = size - 1 - ly;
            ly = tmp;
          }
          const fx = flag & 1 ? size - 1 - lx : lx;
          const fy = flag & 2 ? size - 1 - ly : ly;

          let sx = sxBase + fx;
          let sy = syBase + fy;

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

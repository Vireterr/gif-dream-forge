/**
 * Reassembly: splits image into blocks and moves each block as a solid unit.
 * Blocks are blockSize × blockSize rectangles that move together — no internal
 * shattering. Background is filled from original where blocks moved away.
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

export type ReassemblyMode = 'scatter' | 'flow' | 'swap' | 'vortex';

/**
 * Build reassembly map: for each block, calculate its movement offset.
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
  const flags = new Uint8Array(total);

  const k = Math.max(0, Math.min(100, strength)) / 100;
  const rand = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

  // Movement radius depends on strength and image size
  const maxDim = Math.max(cols, rows);
  const radius = Math.max(1, Math.round(k * maxDim * 0.6));
  const moveChance = 0.8 + k * 0.2; // 80-100% of blocks move

  for (let i = 0; i < total; i++) {
    const bx = i % cols;
    const by = Math.floor(i / cols);

    if (rand() < moveChance) {
      let ox = 0;
      let oy = 0;

      switch (mode) {
        case 'scatter': {
          // Random direction, random distance
          const angle = rand() * Math.PI * 2;
          const dist = (0.3 + rand() * 0.7) * radius;
          ox = Math.round(Math.cos(angle) * dist);
          oy = Math.round(Math.sin(angle) * dist);
          break;
        }

        case 'flow': {
          // Organic flow based on position
          const angle = (bx / cols + by / rows) * Math.PI * 4 + rand() * 0.5;
          const dist = radius * (0.3 + rand() * 0.7);
          ox = Math.round(Math.cos(angle) * dist);
          oy = Math.round(Math.sin(angle) * dist);
          break;
        }

        case 'swap': {
          // Swap with a neighbor in one of 4 directions
          const dir = Math.floor(rand() * 4);
          const swapDist = Math.max(1, Math.round(k * 6));
          if (dir === 0) ox = swapDist;
          else if (dir === 1) ox = -swapDist;
          else if (dir === 2) oy = swapDist;
          else oy = -swapDist;
          break;
        }

        case 'vortex': {
          // Spiral movement around center
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

      // Random flip/rotate flags
      let f = 0;
      if (k > 0.5 && rand() > 0.85) f |= 1; // flip X
      if (k > 0.6 && rand() > 0.9) f |= 2;  // flip Y
      flags[i] = f;
    }
  }

  return { blockSize: size, cols, rows, offsetX, offsetY, flags };
}

/**
 * Apply reassembly map: move each block as a solid rectangle.
 * Background is filled from original where blocks moved away.
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

  // Start with original as background (fills gaps where blocks moved away)
  out.set(src);

  // Track which output pixels have been written by moved blocks
  const written = new Uint8Array(width * height);

  // First pass: clear old positions of moving blocks
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      const ox = offsetX[bi] ?? 0;
      const oy = offsetY[bi] ?? 0;

      if (ox === 0 && oy === 0) continue; // block doesn't move

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);

      // Clear this block's old position (fill with background color or transparent)
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

  // Second pass: place each block at its new position
  // Process larger blocks first (they should win collisions)
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

      // New position (wrap around edges)
      const nx0 = ((x0 + ox * size) % width + width) % width;
      const ny0 = ((y0 + oy * size) % height + height) % height;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const lx = x - x0;
          const ly = y - y0;

          // Apply flip flags
          const fx = flag & 1 ? size - 1 - lx : lx;
          const fy = flag & 2 ? size - 1 - ly : ly;

          // Source coordinates
          const sx = x0 + fx;
          const sy = y0 + fy;

          // Destination coordinates (wrapped)
          const dx = ((nx0 + lx) % width + width) % width;
          const dy = ((ny0 + ly) % height + height) % height;

          const si = (sy * width + sx) * 4;
          const di = (dy * width + dx) * 4;

          // Only write if destination is empty (first block wins)
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

  // Third pass: fill any remaining empty pixels with original
  for (let i = 0; i < width * height; i++) {
    if (!written[i]) {
      const di = i * 4;
      // Check if this pixel was cleared (alpha = 0)
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

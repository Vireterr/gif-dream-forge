/**
 * Reassembly: splits image into blocks and moves each block.
 * Block size is a PERCENTAGE of image size (0-100%).
 * Old positions are filled with AVERAGE NEIGHBOR COLOR (not original).
 * Silhouette mask protects object edges — blocks on boundaries move less.
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

/**
 * Get average color of neighbors (for background fill).
 */
function getAverageNeighborColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  isEmpty: (i: number) => boolean
): { r: number; g: number; b: number; a: number } {
  let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (isEmpty(ni)) continue;
      const pi = ni * 4;
      sumR += rgba[pi];
      sumG += rgba[pi + 1];
      sumB += rgba[pi + 2];
      sumA += rgba[pi + 3];
      count++;
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

export function generateReassemblyMap(
  width: number,
  height: number,
  blockSizePercent: number,
  strength: number,
  seed: number
): ReassemblyMap {
  const k = Math.max(0, Math.min(100, strength)) / 100;
  const percent = Math.max(0, Math.min(100, blockSizePercent)) / 100;

  const size = Math.max(1, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const total = cols * rows;

  const offsetX = new Int16Array(total);
  const offsetY = new Int16Array(total);
  const flags = new Uint8Array(total);

  const rand = mulberry32((seed ^ 0x27d4eb2f) >>> 0);
  const radius = Math.max(1, Math.round(k * size * 0.8));
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

/**
 * Calculate how much a block should be damped based on silhouette mask.
 * Returns 0-1, where 0 = fully damped (on edge), 1 = no damping (not on edge).
 */
function calculateEdgeDamping(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  silhouetteMask: Uint8Array | undefined,
  silhouetteStrength: number
): number {
  if (!silhouetteMask || silhouetteStrength <= 0) return 1;

  const guard = Math.min(100, silhouetteStrength) / 100;
  let sum = 0;
  let count = 0;

  // Sample every 3rd pixel for performance
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      sum += silhouetteMask[y * width + x] ?? 0;
      count++;
    }
  }

  if (count === 0) return 1;

  // edgeValue: 0 = no edges in block, 1 = all pixels are edges
  const edgeValue = sum / count / 255;

  // dampening: 1 = no damping, 0 = fully damped
  const dampening = 1 - Math.min(1, edgeValue * guard);
  return dampening;
}

export function applyReassemblyToFrame(
  frame: Frame,
  map: ReassemblyMap,
  silhouetteMask?: Uint8Array,
  silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  const { blockSize: size, cols, rows, offsetX, offsetY, flags } = map;

  out.set(src);

  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);

  const movedBlocks: Array<{
    pixels: Uint8ClampedArray;
    w: number;
    h: number;
    newX: number;
    newY: number;
    flag: number;
  }> = [];

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const bi = by * cols + bx;
      let ox = offsetX[bi] ?? 0;
      let oy = offsetY[bi] ?? 0;
      const flag = flags[bi] ?? 0;

      if (ox === 0 && oy === 0) continue;

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);
      const w = x1 - x0;
      const h = y1 - y0;

      // 🆕 Apply silhouette damping to this block's movement
      const damping = calculateEdgeDamping(
        x0, y0, x1, y1, width, silhouetteMask, silhouetteStrength
      );
      ox = Math.round(ox * damping);
      oy = Math.round(oy * damping);

      // If fully damped, skip this block
      if (ox === 0 && oy === 0) continue;

      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const lx = x - x0;
          const ly = y - y0;
          const fx = flag & 1 ? w - 1 - lx : lx;
          const fy = flag & 2 ? h - 1 - ly : ly;
          const si = (y * width + x) * 4;
          const di = (ly * w + lx) * 4;
          pixels[di] = src[si];
          pixels[di + 1] = src[si + 1];
          pixels[di + 2] = src[si + 2];
          pixels[di + 3] = src[si + 3];
        }
      }

      const newX = ((x0 + ox * size) % width + width) % width;
      const newY = ((y0 + oy * size) % height + height) % height;

      movedBlocks.push({ pixels, w, h, newX, newY, flag });

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x;
          cleared[idx] = 1;
          const di = idx * 4;
          out[di] = 0;
          out[di + 1] = 0;
          out[di + 2] = 0;
          out[di + 3] = 0;
        }
      }
    }
  }

  for (const block of movedBlocks) {
    const { pixels, w, h, newX, newY } = block;
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const dx = ((newX + lx) % width + width) % width;
        const dy = ((newY + ly) % height + height) % height;
        const di = (dy * width + dx) * 4;
        const si = (ly * w + lx) * 4;
        out[di] = pixels[si];
        out[di + 1] = pixels[si + 1];
        out[di + 2] = pixels[si + 2];
        out[di + 3] = pixels[si + 3];
        written[dy * width + dx] = 1;
      }
    }
  }

  const isEmpty = (i: number) => cleared[i] === 1 && written[i] === 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isEmpty(idx)) {
        const bg = getAverageNeighborColor(src, width, height, x, y, 8, isEmpty);
        const di = idx * 4;
        out[di] = bg.r;
        out[di + 1] = bg.g;
        out[di + 2] = bg.b;
        out[di + 3] = bg.a;
      }
    }
  }

  return out;
}

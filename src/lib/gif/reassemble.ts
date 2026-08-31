/**
 * Reassembly: blocks SWAP positions with each other (like a puzzle).
 * Block size is a PERCENTAGE of image size (0-100%).
 * Old positions are filled with AVERAGE NEIGHBOR COLOR.
 * Silhouette mask protects object edges — blocks on boundaries don't swap.
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
  seed: number,
  silhouetteMask?: Uint8Array,
  silhouetteStrength = 0
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

  // 🆕 Create list of all block indices
  const blockIndices: number[] = [];
  for (let i = 0; i < total; i++) {
    blockIndices.push(i);
  }

  // 🆕 Filter out blocks on edges (if silhouette protection is enabled)
  const movableBlocks: number[] = [];
  for (const i of blockIndices) {
    const bx = i % cols;
    const by = Math.floor(i / cols);
    const x0 = bx * size;
    const y0 = by * size;
    const x1 = Math.min(width, x0 + size);
    const y1 = Math.min(height, y0 + size);

    // Check if this block is on an edge
    let isOnEdge = false;
    if (silhouetteMask && silhouetteStrength > 0) {
      const guard = Math.min(100, silhouetteStrength) / 100;
      let edgeSum = 0;
      let edgeCount = 0;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          edgeSum += silhouetteMask[y * width + x] ?? 0;
          edgeCount++;
        }
      }
      if (edgeCount > 0) {
        const edgeValue = edgeSum / edgeCount / 255;
        if (edgeValue * guard > 0.3) {
          isOnEdge = true;
        }
      }
    }

    if (!isOnEdge) {
      movableBlocks.push(i);
    }
  }

  // 🆕 Shuffle movable blocks (Fisher-Yates algorithm)
  for (let i = movableBlocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [movableBlocks[i], movableBlocks[j]] = [movableBlocks[j], movableBlocks[i]];
  }

  // 🆕 Create swap pairs: block A goes to position of block B, and vice versa
  const swapMap = new Map<number, number>();
  for (let i = 0; i < movableBlocks.length - 1; i += 2) {
    const blockA = movableBlocks[i];
    const blockB = movableBlocks[i + 1];
    
    // Calculate swap offset for block A (where block B is)
    const ax = blockA % cols;
    const ay = Math.floor(blockA / cols);
    const bx = blockB % cols;
    const by = Math.floor(blockB / cols);
    
    offsetX[blockA] = bx - ax;
    offsetY[blockA] = by - ay;
    
    // Calculate swap offset for block B (where block A is)
    offsetX[blockB] = ax - bx;
    offsetY[blockB] = ay - by;
    
    // Random flip for visual variety
    if (k > 0.5 && rand() > 0.7) {
      flags[blockA] |= rand() > 0.5 ? 1 : 2;
      flags[blockB] |= rand() > 0.5 ? 1 : 2;
    }
  }

  // If odd number of blocks, last one stays in place (offsets already 0)

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
      const ox = offsetX[bi] ?? 0;
      const oy = offsetY[bi] ?? 0;
      const flag = flags[bi] ?? 0;

      if (ox === 0 && oy === 0) continue;

      const x0 = bx * size;
      const y0 = by * size;
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);
      const w = x1 - x0;
      const h = y1 - y0;

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

      // 🆕 For swap logic, new position is calculated differently
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

/**
 * Reassembly: each block moves to a RANDOM position.
 * Blocks can overlap. Empty spaces filled by stretching neighbor colors.
 * Block size is a PERCENTAGE of image size (0-100%).
 * Silhouette mask protects object edges.
 */

import type { Frame, ReassemblyMap } from './types';
import { mulberry32 } from '../utils/noise';

/**
 * Fill empty spaces by stretching neighboring pixel colors (BFS).
 */
function fillEmptySpacesWithStretch(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  isEmpty: (i: number) => boolean
): void {
  const total = width * height;
  const queue: Array<[number, number, number, number]> = [];
  const visited = new Uint8Array(total);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isEmpty(idx)) {
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (!isEmpty(nidx)) {
            queue.push([x, y, nx, ny]);
            visited[idx] = 1;
            break;
          }
        }
      }
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const [x, y, srcX, srcY] = queue[qi++];
    const idx = y * width + x;
    const srcIdx = srcY * width + srcX;

    const si = srcIdx * 4;
    const di = idx * 4;
    rgba[di] = rgba[si];
    rgba[di + 1] = rgba[si + 1];
    rgba[di + 2] = rgba[si + 2];
    rgba[di + 3] = rgba[si + 3];

    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (isEmpty(nidx) && !visited[nidx]) {
        queue.push([nx, ny, srcX, srcY]);
        visited[nidx] = 1;
      }
    }
  }
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

  // Max movement = percentage of image size
  const maxMoveBlocks = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));
  const moveChance = 0.7 + k * 0.3;

  for (let i = 0; i < total; i++) {
    const bx = i % cols;
    const by = Math.floor(i / cols);
    const x0 = bx * size;
    const y0 = by * size;
    const x1 = Math.min(width, x0 + size);
    const y1 = Math.min(height, y0 + size);

    // Check silhouette edge
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

    if (isOnEdge) continue;

    if (rand() < moveChance) {
      // Random direction and distance (in block units)
      const angle = rand() * Math.PI * 2;
      const dist = (0.3 + rand() * 0.7) * maxMoveBlocks;
      offsetX[i] = Math.round(Math.cos(angle) * dist);
      offsetY[i] = Math.round(Math.sin(angle) * dist);

      // Random flip
      let f = 0;
      if (k > 0.5 && rand() > 0.8) f |= 1;
      if (k > 0.6 && rand() > 0.85) f |= 2;
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

  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);

  // Save all blocks that will move
  const movedBlocks: Array<{
    pixels: Uint8ClampedArray;
    w: number;
    h: number;
    newX: number;
    newY: number;
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

      // Copy block pixels (with flip)
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

      movedBlocks.push({ pixels, w, h, newX, newY });

      // Clear old position
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          cleared[y * width + x] = 1;
          const di = (y * width + x) * 4;
          out[di] = 0;
          out[di + 1] = 0;
          out[di + 2] = 0;
          out[di + 3] = 0;
        }
      }
    }
  }

  // Place blocks at random positions (can overlap — last one wins)
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

  // Fill empty spaces with stretched neighbor colors
  const isEmpty = (i: number) => cleared[i] === 1 && written[i] === 0;
  fillEmptySpacesWithStretch(out, width, height, isEmpty);

  return out;
}

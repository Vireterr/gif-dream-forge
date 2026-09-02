/**
 * Reassembly with liquid blending:
 * Divides image into a grid. Each cell's mode is determined by Perlin noise 
 * multiplied by the enabled strengths, creating organic, lava-lamp-like boundaries 
 * between Blocks, Stripes, Geometric, and Organic modes.
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';

// ============ PERLIN NOISE ============
class PerlinNoise {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(a: number, b: number, t: number) { return a + t * (b - a); }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    return this.lerp(
      this.lerp(this.grad(this.perm[A], x, y), this.grad(this.perm[B], x - 1, y), u),
      this.lerp(this.grad(this.perm[A + 1], x, y - 1), this.grad(this.perm[B + 1], x - 1, y - 1), u),
      v
    );
  }
}

// ============ MAIN APPLY FUNCTION ============
export function applyReassemblyToFrame(
  frame: Frame,
  blockSize: number,
  config: ReassemblyConfig,
  seed: number,
  _silhouetteMask?: Uint8Array,
  _silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  out.set(src); // Start with original

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;
  if (!anyEnabled || blockSize <= 0) return out;

  const perlin = new PerlinNoise(seed);
  const smoothness = Math.max(0.1, config.blendSmoothness / 100);
  const freq = 0.01 / smoothness; // Lower freq = larger blobs

  const cellSize = Math.max(4, Math.round(blockSize));
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);

  const rand = mulberry32(seed + 999);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = gx * cellSize + cellSize / 2;
      const cy = gy * cellSize + cellSize / 2;
      
      // Sample noise for each mode at this cell's center
      const n1 = (perlin.noise(cx * freq, cy * freq) + 1) / 2;
      const n2 = (perlin.noise(cx * freq + 100, cy * freq + 100) + 1) / 2;
      const n3 = (perlin.noise(cx * freq + 200, cy * freq + 200) + 1) / 2;
      const n4 = (perlin.noise(cx * freq + 300, cy * freq + 300) + 1) / 2;

      // Calculate scores based on enabled state and strength
      const scores = [
        { mode: 'blocks' as const, score: config.blocks.enabled ? n1 * (config.blocks.strength / 100) : 0 },
        { mode: 'stripes' as const, score: config.stripes.enabled ? n2 * (config.stripes.strength / 100) : 0 },
        { mode: 'geometric' as const, score: config.geometric.enabled ? n3 * (config.geometric.strength / 100) : 0 },
        { mode: 'organic' as const, score: config.organic.enabled ? n4 * (config.organic.strength / 100) : 0 },
      ];

      // Find the winning mode for this cell
      scores.sort((a, b) => b.score - a.score);
      const winner = scores[0];

      if (winner.score <= 0.05) continue; // No effect applied, keep original

      const x0 = gx * cellSize;
      const y0 = gy * cellSize;
      const x1 = Math.min(width, x0 + cellSize);
      const y1 = Math.min(height, y0 + cellSize);
      const w = x1 - x0;
      const h = y1 - y0;

      // Apply the winning mode to this specific cell
      if (winner.mode === 'blocks') {
        applyBlockCell(src, out, x0, y0, w, h, width, height, config.blocks.strength, rand, cleared, written);
      } else if (winner.mode === 'stripes') {
        applyStripeCell(src, out, x0, y0, w, h, width, height, config.stripes.strength, rand, cleared, written);
      } else if (winner.mode === 'geometric') {
        applyGeometricCell(src, out, x0, y0, w, h, width, height, cx, cy, config.geometric.strength, rand, cleared, written);
      } else if (winner.mode === 'organic') {
        applyOrganicCell(src, out, x0, y0, w, h, width, height, cx, cy, config.organic.strength, rand, cleared, written);
      }
    }
  }

  // Fill empty spaces
  fillEmptySpacesWithStretch(out, width, height, (i: number) => cleared[i] === 1 && written[i] === 0);
  return out;
}

// ============ CELL PROCESSORS ============
function applyBlockCell(src: Uint8ClampedArray, out: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, width: number, height: number, strength: number, rand: () => number, cleared: Uint8Array, written: Uint8Array) {
  const k = strength / 100;
  const maxMove = Math.max(1, Math.round(k * Math.max(w, h) * 1.5));
  const angle = rand() * Math.PI * 2;
  const dist = (0.3 + rand() * 0.7) * maxMove;
  const ox = Math.round(Math.cos(angle) * dist);
  const oy = Math.round(Math.sin(angle) * dist);

  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const si = (y * width + x) * 4;
      const di = ((y - y0) * w + (x - x0)) * 4;
      pixels[di] = src[si]; pixels[di+1] = src[si+1]; pixels[di+2] = src[si+2]; pixels[di+3] = src[si+3];
    }
  }

  const newX = ((x0 + ox) % width + width) % width;
  const newY = ((y0 + oy) % height + height) % height;

  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const dx = ((newX + lx) % width + width) % width;
      const dy = ((newY + ly) % height + height) % height;
      const di = (dy * width + dx) * 4;
      const si = (ly * w + lx) * 4;
      out[di] = pixels[si]; out[di+1] = pixels[si+1]; out[di+2] = pixels[si+2]; out[di+3] = pixels[si+3];
      written[dy * width + dx] = 1;
    }
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cleared[y * width + x] = 1;
}

function applyStripeCell(src: Uint8ClampedArray, out: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, width: number, height: number, strength: number, rand: () => number, cleared: Uint8Array, written: Uint8Array) {
  const k = strength / 100;
  const isHorizontal = rand() > 0.5;
  const maxOffset = Math.round(k * (isHorizontal ? width : height) * 0.5);
  const offset = Math.round((rand() * 2 - 1) * maxOffset);
  if (offset === 0) return;

  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const si = (y * width + x) * 4;
      const di = ((y - y0) * w + (x - x0)) * 4;
      pixels[di] = src[si]; pixels[di+1] = src[si+1]; pixels[di+2] = src[si+2]; pixels[di+3] = src[si+3];
    }
  }

  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const dx = ((x0 + lx + (isHorizontal ? offset : 0)) % width + width) % width;
      const dy = ((y0 + ly + (isHorizontal ? 0 : offset)) % height + height) % height;
      const di = (dy * width + dx) * 4;
      const si = (ly * w + lx) * 4;
      out[di] = pixels[si]; out[di+1] = pixels[si+1]; out[di+2] = pixels[si+2]; out[di+3] = pixels[si+3];
      written[dy * width + dx] = 1;
    }
  }
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cleared[y * width + x] = 1;
}

function applyGeometricCell(src: Uint8ClampedArray, out: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, width: number, height: number, cx: number, cy: number, strength: number, rand: () => number, cleared: Uint8Array, written: Uint8Array) {
  const k = strength / 100;
  const maxMove = Math.round(k * Math.max(w, h) * 1.5);
  const angle = rand() * Math.PI * 2;
  const dist = (0.3 + rand() * 0.7) * maxMove;
  const ox = Math.round(Math.cos(angle) * dist);
  const oy = Math.round(Math.sin(angle) * dist);

  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const newX = ((x + ox) % width + width) % width;
      const newY = ((y + oy) % height + height) % height;
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
      written[newY * width + newX] = 1;
      cleared[y * width + x] = 1;
    }
  }
}

function applyOrganicCell(src: Uint8ClampedArray, out: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, width: number, height: number, cx: number, cy: number, strength: number, rand: () => number, cleared: Uint8Array, written: Uint8Array) {
  const k = strength / 100;
  const maxMove = Math.round(k * Math.max(w, h) * 1.5);
  
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // Organic distortion: distance from center affects direction
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) + (rand() - 0.5) * 2; // Add randomness
      const move = dist * k * 0.5;
      
      const ox = Math.round(Math.cos(angle) * move);
      const oy = Math.round(Math.sin(angle) * move);

      const newX = ((x + ox) % width + width) % width;
      const newY = ((y + oy) % height + height) % height;
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
      written[newY * width + newX] = 1;
      cleared[y * width + x] = 1;
    }
  }
}

// ============ FILL EMPTY SPACES ============
function fillEmptySpacesWithStretch(rgba: Uint8ClampedArray, width: number, height: number, isEmpty: (i: number) => boolean): void {
  const total = width * height;
  const queue: Array<[number, number, number, number]> = [];
  const visited = new Uint8Array(total);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isEmpty(idx)) {
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
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
    rgba[di] = rgba[si]; rgba[di+1] = rgba[si+1]; rgba[di+2] = rgba[si+2]; rgba[di+3] = rgba[si+3];

    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
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

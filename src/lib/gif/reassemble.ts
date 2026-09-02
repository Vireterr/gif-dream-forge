/**
 * Reassembly with liquid blending - FINAL VERSION:
 * - Blocks: square mosaic tiles
 * - Stripes: horizontal/vertical strips
 * - Geometric: triangles, diamonds, hexagons
 * - Organic: blob-like shapes that move as whole units
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';

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

export function applyReassemblyToFrame(
  frame: Frame,
  blockSizePercent: number,
  config: ReassemblyConfig,
  seed: number,
  _silhouetteMask?: Uint8Array,
  _silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;
  if (!anyEnabled || blockSizePercent <= 0) return out;

  const perlin = new PerlinNoise(seed);
  const smoothness = Math.max(0.1, config.blendSmoothness / 100);
  const freq = 0.01 / smoothness;

  const percent = Math.max(0, Math.min(100, blockSizePercent)) / 100;
  const cellSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed + 999);

  const cellModes: Array<'blocks' | 'stripes' | 'geometric' | 'organic' | null> = [];
  
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = gx * cellSize + cellSize / 2;
      const cy = gy * cellSize + cellSize / 2;
      
      const n1 = (perlin.noise(cx * freq, cy * freq) + 1) / 2;
      const n2 = (perlin.noise(cx * freq + 100, cy * freq + 100) + 1) / 2;
      const n3 = (perlin.noise(cx * freq + 200, cy * freq + 200) + 1) / 2;
      const n4 = (perlin.noise(cx * freq + 300, cy * freq + 300) + 1) / 2;

      const scores = [
        { mode: 'blocks' as const, score: config.blocks.enabled ? n1 * (config.blocks.strength / 100) : 0 },
        { mode: 'stripes' as const, score: config.stripes.enabled ? n2 * (config.stripes.strength / 100) : 0 },
        { mode: 'geometric' as const, score: config.geometric.enabled ? n3 * (config.geometric.strength / 100) : 0 },
        { mode: 'organic' as const, score: config.organic.enabled ? n4 * (config.organic.strength / 100) : 0 },
      ];

      scores.sort((a, b) => b.score - a.score);
      const winner = scores[0];
      cellModes.push(winner.score > 0.05 ? winner.mode : null);
    }
  }

  if (config.blocks.enabled) {
    applyBlocksMode(src, out, width, height, cellSize, cols, rows, cellModes, config.blocks.strength, rand, cleared, written);
  }

  if (config.stripes.enabled) {
    applyStripesMode(src, out, width, height, cellSize, cols, rows, cellModes, config.stripes.strength, rand, cleared, written);
  }

  if (config.geometric.enabled) {
    applyGeometricMode(src, out, width, height, cellSize, cols, rows, cellModes, config.geometric.strength, rand, cleared, written);
  }

  if (config.organic.enabled) {
    applyOrganicMode(src, out, width, height, cellSize, cols, rows, cellModes, config.organic.strength, seed, cleared, written);
  }

  fillEmptySpacesWithStretch(out, width, height, (i: number) => cleared[i] === 1 && written[i] === 0);
  return out;
}

function applyBlocksMode(
  src: Uint8ClampedArray, out: Uint8ClampedArray,
  width: number, height: number,
  cellSize: number, cols: number, rows: number,
  cellModes: Array<'blocks' | 'stripes' | 'geometric' | 'organic' | null>,
  strength: number, rand: () => number,
  cleared: Uint8Array, written: Uint8Array
) {
  const k = strength / 100;
  const maxMove = Math.max(1, Math.round(k * cellSize * 1.5));

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (cellModes[gy * cols + gx] !== 'blocks') continue;

      const x0 = gx * cellSize;
      const y0 = gy * cellSize;
      const x1 = Math.min(width, x0 + cellSize);
      const y1 = Math.min(height, y0 + cellSize);
      const w = x1 - x0;
      const h = y1 - y0;

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
  }
}

function applyStripesMode(
  src: Uint8ClampedArray, out: Uint8ClampedArray,
  width: number, height: number,
  cellSize: number, cols: number, rows: number,
  cellModes: Array<'blocks' | 'stripes' | 'geometric' | 'organic' | null>,
  strength: number, rand: () => number,
  cleared: Uint8Array, written: Uint8Array
) {
  const k = strength / 100;
  const isHorizontal = rand() > 0.5;
  const baseDim = isHorizontal ? height : width;
  const maxOffset = Math.round(k * baseDim * 0.4);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (cellModes[gy * cols + gx] !== 'stripes') continue;

      const x0 = gx * cellSize;
      const y0 = gy * cellSize;
      const x1 = Math.min(width, x0 + cellSize);
      const y1 = Math.min(height, y0 + cellSize);
      const w = x1 - x0;
      const h = y1 - y0;

      const offset = Math.round((rand() * 2 - 1) * maxOffset);
      if (offset === 0) continue;

      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
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
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cleared[y * width + x] = 1;
    }
  }
}

function isPointInTriangle(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const x = px - cx;
  const y = py - cy;
  if (y < -size / 2 || y > size / 2) return false;
  const halfWidth = (size / 2) * (1 - (y + size / 2) / size);
  return Math.abs(x) <= halfWidth;
}

function isPointInDiamond(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const x = Math.abs(px - cx);
  const y = Math.abs(py - cy);
  return (x / size + y / size) <= 1;
}

function isPointInHexagon(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const x = Math.abs(px - cx);
  const y = Math.abs(py - cy);
  return x <= size * 0.866 && y <= size * 0.5 && (x * 0.5 + y * 0.866) <= size * 0.866;
}

function applyGeometricMode(
  src: Uint8ClampedArray, out: Uint8ClampedArray,
  width: number, height: number,
  cellSize: number, cols: number, rows: number,
  cellModes: Array<'blocks' | 'stripes' | 'geometric' | 'organic' | null>,
  strength: number, rand: () => number,
  cleared: Uint8Array, written: Uint8Array
) {
  const k = strength / 100;
  const maxMove = Math.round(k * cellSize * 1.5);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (cellModes[gy * cols + gx] !== 'geometric') continue;

      const cx = gx * cellSize + cellSize / 2;
      const cy = gy * cellSize + cellSize / 2;
      const size = cellSize * 0.8;
      const types = [1, 2, 3];
      const type = types[Math.floor(rand() * 3)];

      const angle = rand() * Math.PI * 2;
      const dist = (0.3 + rand() * 0.7) * maxMove;
      const ox = Math.round(Math.cos(angle) * dist);
      const oy = Math.round(Math.sin(angle) * dist);

      const x0 = Math.max(0, Math.floor(cx - size));
      const y0 = Math.max(0, Math.floor(cy - size));
      const x1 = Math.min(width, Math.ceil(cx + size));
      const y1 = Math.min(height, Math.ceil(cy + size));

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          let inside = false;
          if (type === 1) inside = isPointInTriangle(x, y, cx, cy, size);
          else if (type === 2) inside = isPointInDiamond(x, y, cx, cy, size);
          else if (type === 3) inside = isPointInHexagon(x, y, cx, cy, size);

          if (inside) {
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
    }
  }
}

function applyOrganicMode(
  src: Uint8ClampedArray, out: Uint8ClampedArray,
  width: number, height: number,
  cellSize: number, cols: number, rows: number,
  cellModes: Array<'blocks' | 'stripes' | 'geometric' | 'organic' | null>,
  strength: number, seed: number,
  cleared: Uint8Array, written: Uint8Array
) {
  const k = strength / 100;
  const blobPerlin = new PerlinNoise(seed + 777);
  const blobFreq = 0.05;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (cellModes[gy * cols + gx] !== 'organic') continue;

      const cx = gx * cellSize + cellSize / 2;
      const cy = gy * cellSize + cellSize / 2;
      const maxRadius = cellSize * 0.9;

      // Determine movement direction for this blob
      const moveAngle = blobPerlin.noise(cx * 0.01, cy * 0.01) * Math.PI * 2;
      const moveDist = Math.round(k * cellSize * 1.2);
      const moveX = Math.round(Math.cos(moveAngle) * moveDist);
      const moveY = Math.round(Math.sin(moveAngle) * moveDist);

      const x0 = Math.max(0, Math.floor(cx - maxRadius));
      const y0 = Math.max(0, Math.floor(cy - maxRadius));
      const x1 = Math.min(width, Math.ceil(cx + maxRadius));
      const y1 = Math.min(height, Math.ceil(cy + maxRadius));

      // Collect pixels that belong to this organic blob
      const blobPixels: Array<{ x: number; y: number }> = [];

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxRadius) {
            // Use Perlin noise to create organic shape
            const noiseVal = blobPerlin.noise(x * blobFreq, y * blobFreq);
            const threshold = 0.2 + (dist / maxRadius) * 0.6;
            
            if (noiseVal > threshold - 0.5) {
              blobPixels.push({ x, y });
            }
          }
        }
      }

      // Move all pixels in the blob together
      for (const pixel of blobPixels) {
        const newX = ((pixel.x + moveX) % width + width) % width;
        const newY = ((pixel.y + moveY) % height + height) % height;
        const si = (pixel.y * width + pixel.x) * 4;
        const di = (newY * width + newX) * 4;
        out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
        written[newY * width + newX] = 1;
        cleared[pixel.y * width + pixel.x] = 1;
      }
    }
  }
}

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

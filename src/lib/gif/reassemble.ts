/**
 * Reassembly: Backward Mapping + BFS Fill + Wave Effect
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

// BFS заполнение пустых зон растянутыми соседними пикселями
function fillEmptySpaces(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  isEmpty: Uint8Array
): void {
  const queue: Array<[number, number, number, number]> = [];
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isEmpty[idx]) {
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (!isEmpty[nidx]) {
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
    
    out[di] = out[si];
    out[di + 1] = out[si + 1];
    out[di + 2] = out[si + 2];
    out[di + 3] = out[si + 3];
    isEmpty[idx] = 0;

    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (isEmpty[nidx] && !visited[nidx]) {
        queue.push([nx, ny, srcX, srcY]);
        visited[nidx] = 1;
      }
    }
  }
}

// БЛОКИ: Forward mapping + BFS fill
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));
  const isEmpty = new Uint8Array(width * height);
  isEmpty.fill(1);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      if (rand() < 0.7 + k * 0.3) {
        const x0 = bx * blockSize;
        const y0 = by * blockSize;
        const x1 = Math.min(width, x0 + blockSize);
        const y1 = Math.min(height, y0 + blockSize);
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
            pixels[di] = src[si];
            pixels[di + 1] = src[si + 1];
            pixels[di + 2] = src[si + 2];
            pixels[di + 3] = src[si + 3];
          }
        }

        const newX = x0 + ox;
        const newY = y0 + oy;

        for (let ly = 0; ly < h; ly++) {
          for (let lx = 0; lx < w; lx++) {
            const dx = newX + lx;
            const dy = newY + ly;
            if (dx < 0 || dx >= width || dy < 0 || dy >= height) continue;
            const di = (dy * width + dx) * 4;
            const si = (ly * w + lx) * 4;
            out[di] = pixels[si];
            out[di + 1] = pixels[si + 1];
            out[di + 2] = pixels[si + 2];
            out[di + 3] = pixels[si + 3];
            isEmpty[dy * width + dx] = 0;
          }
        }
      }
    }
  }

  fillEmptySpaces(out, width, height, isEmpty);
  return isEmpty;
}

// ПОЛОСЫ: Forward mapping + BFS fill
function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(Math.min(width, height) * percent));
  const maxOffset = Math.round(k * Math.max(width, height) * 0.5);
  const isHorizontal = rand() > 0.5;
  const baseDim = isHorizontal ? height : width;
  const isEmpty = new Uint8Array(width * height);
  isEmpty.fill(1);

  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const end = Math.min(baseDim, pos + thickness);
    const offset = Math.round((rand() * 2 - 1) * maxOffset);

    if (offset !== 0) {
      if (isHorizontal) {
        for (let y = pos; y < end; y++) {
          for (let x = 0; x < width; x++) {
            const newX = x + offset;
            if (newX < 0 || newX >= width) continue;
            const si = (y * width + x) * 4;
            const di = (y * width + newX) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
            isEmpty[y * width + newX] = 0;
          }
        }
      } else {
        for (let x = pos; x < end; x++) {
          for (let y = 0; y < height; y++) {
            const newY = y + offset;
            if (newY < 0 || newY >= height) continue;
            const si = (y * width + x) * 4;
            const di = (newY * width + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
            isEmpty[newY * width + x] = 0;
          }
        }
      }
    }
    pos = end;
  }

  fillEmptySpaces(out, width, height, isEmpty);
  return isEmpty;
}

// ГЕОМЕТРИЯ: Forward mapping + BFS fill
function applyGeometricMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(3, Math.min(40, sizePercent)) / 100;
  const baseSize = Math.max(8, Math.round(Math.min(width, height) * percent));
  const maxMove = Math.round(k * baseSize * 1.5);
  const numShapes = Math.max(5, Math.round((width * height) / (baseSize * baseSize) * 0.5));
  const isEmpty = new Uint8Array(width * height);
  isEmpty.fill(1);

  interface Shape { cx: number; cy: number; size: number; type: number; rotation: number; ox: number; oy: number }
  const shapes: Shape[] = [];

  for (let i = 0; i < numShapes; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const size = baseSize * (0.6 + rand() * 0.8);
    const types = [1, 2, 3];
    const type = types[Math.floor(rand() * 3)];
    const rotation = rand() * Math.PI * 2;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    shapes.push({ cx, cy, size, type, rotation, ox: Math.round(Math.cos(angle) * dist), oy: Math.round(Math.sin(angle) * dist) });
  }

  const isInside = (px: number, py: number, s: Shape) => {
    const cos = Math.cos(-s.rotation);
    const sin = Math.sin(-s.rotation);
    const pdx = px - s.cx;
    const pdy = py - s.cy;
    const rx = Math.abs(pdx * cos - pdy * sin);
    const ry = Math.abs(pdx * sin + pdy * cos);
    if (s.type === 1) {
      const h = s.size * 1.2;
      if (ry < -h / 2 || ry > h / 2) return false;
      return Math.abs(rx) <= (s.size / 2) * (1 - (ry + h / 2) / h);
    }
    if (s.type === 2) return (rx / s.size + ry / s.size) <= 1;
    if (s.type === 3) return rx <= s.size * 0.866 && ry <= s.size * 0.5 && (rx * 0.5 + ry * 0.866) <= s.size * 0.866;
    return false;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const s of shapes) {
        if (isInside(x, y, s)) {
          const newX = x + s.ox;
          const newY = y + s.oy;
          if (newX < 0 || newX >= width || newY < 0 || newY >= height) break;
          const si = (y * width + x) * 4;
          const di = (newY * width + newX) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
          isEmpty[newY * width + newX] = 0;
          break;
        }
      }
    }
  }

  fillEmptySpaces(out, width, height, isEmpty);
  return isEmpty;
}

// ПРОИЗВОЛЬНЫЕ (Voronoi): Forward mapping + BFS fill
function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const baseCellSize = Math.max(10, Math.round(Math.min(width, height) * percent));
  const numCells = Math.max(3, Math.round((width * height) / (baseCellSize * baseCellSize) * 0.7));
  const maxMove = Math.round(k * baseCellSize * 1.5);
  const isEmpty = new Uint8Array(width * height);
  isEmpty.fill(1);

  interface VCell { cx: number; cy: number; ox: number; oy: number }
  const vcells: VCell[] = [];

  for (let i = 0; i < numCells; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    vcells.push({ cx, cy, ox: Math.round(Math.cos(angle) * dist), oy: Math.round(Math.sin(angle) * dist) });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < vcells.length; i++) {
        const dx = x - vcells[i].cx;
        const dy = y - vcells[i].cy;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
      const cell = vcells[nearestIdx];
      const newX = x + cell.ox;
      const newY = y + cell.oy;
      if (newX < 0 || newX >= width || newY < 0 || newY >= height) continue;
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
      isEmpty[newY * width + newX] = 0;
    }
  }

  fillEmptySpaces(out, width, height, isEmpty);
  return isEmpty;
}

// ВОЛНЫ (Domain Warping): Backward mapping
function applyWaveMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
  smoothness: number,
  seed: number
): void {
  const perlin1 = new PerlinNoise(seed);
  const perlin2 = new PerlinNoise(seed + 7777);
  
  const k = strength / 100;
  const smooth = Math.max(0.1, smoothness / 100);
  const freq = 0.01 / smooth;
  const warpAmount = k * 20;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n1x = perlin1.noise(x * freq, y * freq);
      const n1y = perlin1.noise(x * freq + 5.2, y * freq + 1.3);
      
      const qx = x + n1x * warpAmount;
      const qy = y + n1y * warpAmount;
      
      const n2x = perlin2.noise(qx * freq * 0.7, qy * freq * 0.7);
      const n2y = perlin2.noise(qx * freq * 0.7 + 8.3, qy * freq * 0.7 + 2.8);

      const srcX = Math.round(x + n2x * warpAmount * 0.5);
      const srcY = Math.round(y + n2y * warpAmount * 0.5);

      const clampedX = Math.max(0, Math.min(width - 1, srcX));
      const clampedY = Math.max(0, Math.min(height - 1, srcY));

      const si = (clampedY * width + clampedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ГЛАВНАЯ ФУНКЦИЯ
export function applyReassemblyToFrame(
  frame: Frame,
  _blockSize: number,
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

  if (!anyEnabled) return out;

  if (config.blocks.enabled && config.blocks.strength > 0) {
    const temp = new Uint8ClampedArray(src.length);
    applyBlocksMode(src, temp, width, height, config.blocks.size, config.blocks.strength, seed);
    out.set(temp);
  }

  if (config.stripes.enabled && config.stripes.strength > 0) {
    const temp = new Uint8ClampedArray(out.length);
    applyStripesMode(out, temp, width, height, config.stripes.size, config.stripes.strength, seed + 1);
    out.set(temp);
  }

  if (config.geometric.enabled && config.geometric.strength > 0) {
    const temp = new Uint8ClampedArray(out.length);
    applyGeometricMode(out, temp, width, height, config.geometric.size, config.geometric.strength, seed + 2);
    out.set(temp);
  }

  if (config.organic.enabled && config.organic.strength > 0) {
    const temp = new Uint8ClampedArray(out.length);
    applyOrganicMode(out, temp, width, height, config.organic.size, config.organic.strength, seed + 3);
    out.set(temp);
  }

  // Волны применяются случайно
  if (config.wave?.enabled && config.wave.strength > 0) {
    const waveRand = mulberry32(seed + 9999);
    if (waveRand() < config.wave.probability / 100) {
      const temp = new Uint8ClampedArray(out.length);
      applyWaveMode(out, temp, width, height, config.wave.strength, config.wave.smoothness, seed + 4);
      out.set(temp);
    }
  }

  return out;
}

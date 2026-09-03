/**
 * Reassembly: Backward Mapping + Noise per Block/Zone
 * - Шум вычисляется ОДИН РАЗ для всего блока/зоны
 * - Backward Mapping: для каждого пикселя результата находим источник
 * - Нет дыр, нет медленного BFS заполнения
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';
import { SimplexNoise } from './simplex';

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

// ============ БЛОКИ: Backward Mapping ============
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));

  // Backward Mapping: для каждого пикселя результата находим источник
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blockSize);
      const by = Math.floor(y / blockSize);
      
      // Вычисляем смещение для этого блока (ОДИН РАЗ на блок)
      const blockRand = mulberry32(seed + bx * 1000 + by);
      const angle = blockRand() * Math.PI * 2;
      const dist = (0.3 + blockRand() * 0.7) * maxMove;
      const ox = Math.round(Math.cos(angle) * dist);
      const oy = Math.round(Math.sin(angle) * dist);

      // Инвертируем смещение (backward)
      const srcX = x - ox * blockSize;
      const srcY = y - oy * blockSize;

      // Wrap-around
      const wrappedX = ((srcX % width) + width) % width;
      const wrappedY = ((srcY % height) + height) % height;

      const si = (wrappedY * width + wrappedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ ПОЛОСЫ: Backward Mapping ============
function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(Math.min(width, height) * percent));
  const maxOffset = Math.round(k * Math.max(width, height) * 0.5);
  const isHorizontal = rand() > 0.5;

  // Предвычисляем смещения для всех полос
  const baseDim = isHorizontal ? height : width;
  const stripeOffsets: number[] = [];
  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const offset = Math.round((rand() * 2 - 1) * maxOffset);
    stripeOffsets.push(offset);
    pos += thickness;
  }

  // Backward Mapping
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let srcX = x;
      let srcY = y;

      if (isHorizontal) {
        const stripeIdx = Math.floor(y / stripeWidth);
        const offset = stripeOffsets[stripeIdx] || 0;
        srcX = x - offset;
      } else {
        const stripeIdx = Math.floor(x / stripeWidth);
        const offset = stripeOffsets[stripeIdx] || 0;
        srcY = y - offset;
      }

      const wrappedX = ((srcX % width) + width) % width;
      const wrappedY = ((srcY % height) + height) % height;

      const si = (wrappedY * width + wrappedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ ГЕОМЕТРИЯ: Backward Mapping ============
function applyGeometricMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(3, Math.min(40, sizePercent)) / 100;
  const baseSize = Math.max(8, Math.round(Math.min(width, height) * percent));
  const maxMove = Math.round(k * baseSize * 1.5);
  const numShapes = Math.max(5, Math.round((width * height) / (baseSize * baseSize) * 0.5));

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

  // Backward Mapping
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let srcX = x;
      let srcY = y;

      for (const s of shapes) {
        if (isInside(x, y, s)) {
          srcX = x - s.ox;
          srcY = y - s.oy;
          break;
        }
      }

      const wrappedX = ((srcX % width) + width) % width;
      const wrappedY = ((srcY % height) + height) % height;

      const si = (wrappedY * width + wrappedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ ПРОИЗВОЛЬНЫЕ (Voronoi): Backward Mapping ============
function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const baseCellSize = Math.max(10, Math.round(Math.min(width, height) * percent));
  const numCells = Math.max(3, Math.round((width * height) / (baseCellSize * baseCellSize) * 0.7));
  const maxMove = Math.round(k * baseCellSize * 1.5);

  interface VCell { cx: number; cy: number; ox: number; oy: number }
  const vcells: VCell[] = [];

  for (let i = 0; i < numCells; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    vcells.push({ cx, cy, ox: Math.round(Math.cos(angle) * dist), oy: Math.round(Math.sin(angle) * dist) });
  }

  // Backward Mapping
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
      const srcX = x - cell.ox;
      const srcY = y - cell.oy;

      const wrappedX = ((srcX % width) + width) % width;
      const wrappedY = ((srcY % height) + height) % height;

      const si = (wrappedY * width + wrappedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ ВОЛНЫ (Domain Warping): Backward Mapping ============
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

  // Backward Mapping
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

      const wrappedX = ((srcX % width) + width) % width;
      const wrappedY = ((srcY % height) + height) % height;

      const si = (wrappedY * width + wrappedX) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ ГЛАВНАЯ ФУНКЦИЯ ============
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

  // Применяем режимы последовательно (каждый к результату предыдущего)
  if (config.blocks.enabled && config.blocks.strength > 0) {
    const temp = new Uint8ClampedArray(src.length);
    applyBlocksMode(out, temp, width, height, config.blocks.size, config.blocks.strength, seed);
    out.set(temp);
  }

  if (config.stripes.enabled && config.stripes.strength > 0) {
    const temp = new Uint8ClampedArray(src.length);
    applyStripesMode(out, temp, width, height, config.stripes.size, config.stripes.strength, seed + 1);
    out.set(temp);
  }

  if (config.geometric.enabled && config.geometric.strength > 0) {
    const temp = new Uint8ClampedArray(src.length);
    applyGeometricMode(out, temp, width, height, config.geometric.size, config.geometric.strength, seed + 2);
    out.set(temp);
  }

  if (config.organic.enabled && config.organic.strength > 0) {
    const temp = new Uint8ClampedArray(src.length);
    applyOrganicMode(out, temp, width, height, config.organic.size, config.organic.strength, seed + 3);
    out.set(temp);
  }

  return out;
}

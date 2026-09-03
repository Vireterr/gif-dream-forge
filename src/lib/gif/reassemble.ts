/**
 * Reassembly: Backward Mapping + Noise per Block/Zone
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';

// ============ БЛОКИ ============
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): void {
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blockSize);
      const by = Math.floor(y / blockSize);

      const blockRand = mulberry32(seed + bx * 1000 + by);
      const angle = blockRand() * Math.PI * 2;
      const dist = (0.3 + blockRand() * 0.7) * maxMove;
      const ox = Math.round(Math.cos(angle) * dist);
      const oy = Math.round(Math.sin(angle) * dist);

      const srcX = x - ox * blockSize;
      const srcY = y - oy * blockSize;

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

// ============ ПОЛОСЫ ============
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

  const baseDim = isHorizontal ? height : width;
  const stripeOffsets: number[] = [];
  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const offset = Math.round((rand() * 2 - 1) * maxOffset);
    stripeOffsets.push(offset);
    pos += thickness;
  }

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

// ============ ГЕОМЕТРИЯ ============
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

// ============ ПРОИЗВОЛЬНЫЕ (Voronoi) ============
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

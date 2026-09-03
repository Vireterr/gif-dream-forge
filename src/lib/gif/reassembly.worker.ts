/**
* Web Worker для обработки кадров GIF
* Выносит тяжелые вычисления в отдельный поток
* Эффект "стеклышек": плавное смешивание режимов через alpha маски
* Clamp: изображение не улетает за кадр
*/
import type { Frame, ReassemblyConfig } from './engine';
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

function generateMask(
  width: number,
  height: number,
  config: ReassemblyConfig,
  seed: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (!config.mask.enabled || config.mask.strength === 0) {
    mask.fill(255);
    return mask;
  }
  const simplex = new SimplexNoise(seed);
  const smoothness = Math.max(0.1, config.mask.smoothness / 100);
  const freq = 0.005 / smoothness;
  const strength = config.mask.strength / 100;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x * freq;
      const ny = y * freq;
      const n = (simplex.noise(nx, ny) + 1) / 2;
      mask[y * width + x] = Math.round(n * 255 * strength);
    }
  }
  return mask;
}

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
        // CLAMP вместо модульной арифметики
        const newX = Math.max(0, Math.min(width - blockSize, x0 + ox * blockSize));
        const newY = Math.max(0, Math.min(height - blockSize, y0 + oy * blockSize));
        for (let ly = 0; ly < h; ly++) {
          for (let lx = 0; lx < w; lx++) {
            // CLAMP вместо модульной арифметики
            const dx = Math.max(0, Math.min(width - 1, newX + lx));
            const dy = Math.max(0, Math.min(height - 1, newY + ly));
            const di = (dy * width + dx) * 4;
            const si = (ly * w + lx) * 4;
            out[di] = pixels[si];
            out[di + 1] = pixels[si + 1];
            out[di + 2] = pixels[si + 2];
            out[di + 3] = pixels[si + 3];
          }
        }
      }
    }
  }
}

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
  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const end = Math.min(baseDim, pos + thickness);
    const offset = Math.round((rand() * 2 - 1) * maxOffset);
    if (offset !== 0) {
      if (isHorizontal) {
        for (let y = pos; y < end; y++) {
          for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            // CLAMP вместо модульной арифметики
            const newX = Math.max(0, Math.min(width - 1, x + offset));
            const di = (y * width + newX) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
          }
        }
      } else {
        for (let x = pos; x < end; x++) {
          for (let y = 0; y < height; y++) {
            const si = (y * width + x) * 4;
            // CLAMP вместо модульной арифметики
            const newY = Math.max(0, Math.min(height - 1, y + offset));
            const di = (newY * width + x) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
          }
        }
      }
    }
    pos = end;
  }
}

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
      for (const s of shapes) {
        if (isInside(x, y, s)) {
          // CLAMP вместо модульной арифметики
          const newX = Math.max(0, Math.min(width - 1, x + s.ox));
          const newY = Math.max(0, Math.min(height - 1, y + s.oy));
          const si = (y * width + x) * 4;
          const di = (newY * width + newX) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
          break;
        }
      }
    }
  }
}

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
      // CLAMP вместо модульной арифметики
      const newX = Math.max(0, Math.min(width - 1, x + cell.ox));
      const newY = Math.max(0, Math.min(height - 1, y + cell.oy));
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

function applySilhouetteProtection(
  out: Uint8ClampedArray,
  src: Uint8ClampedArray,
  width: number,
  height: number,
  silhouetteMask: Uint8Array,
  silhouetteStrength: number
): void {
  const guard = Math.min(100, silhouetteStrength) / 100;
  const threshold = 0.3 * guard;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const edgeValue = silhouetteMask[idx] / 255;
      if (edgeValue > threshold) {
        const di = idx * 4;
        out[di] = src[di];
        out[di + 1] = src[di + 1];
        out[di + 2] = src[di + 2];
        out[di + 3] = src[di + 3];
      }
    }
  }
}

// Worker message handler
self.onmessage = (e: MessageEvent) => {
  const { frame, config, seed, silhouetteMask, silhouetteStrength } = e.data;
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);
  const anyEnabled = config.blocks.enabled || config.stripes.enabled ||
                     config.geometric.enabled || config.organic.enabled;
  if (!anyEnabled) {
    self.postMessage({ rgba: out.buffer });
    return;
  }
  const mask = generateMask(width, height, config, seed);

  // БЛОКИ — плавное смешивание через alpha
  if (config.blocks.enabled && config.blocks.strength > 0) {
    const blocksOut = new Uint8ClampedArray(src.length);
    blocksOut.set(src);
    applyBlocksMode(src, blocksOut, width, height, config.blocks.size, config.blocks.strength, seed);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const di = idx * 4;
        const alpha = mask[idx] / 255; // 0.0 - 1.0
        // Смешиваем: оригинал * (1 - alpha) + эффект * alpha
        out[di] = out[di] * (1 - alpha) + blocksOut[di] * alpha;
        out[di + 1] = out[di + 1] * (1 - alpha) + blocksOut[di + 1] * alpha;
        out[di + 2] = out[di + 2] * (1 - alpha) + blocksOut[di + 2] * alpha;
        out[di + 3] = out[di + 3] * (1 - alpha) + blocksOut[di + 3] * alpha;
      }
    }
  }

  // ПОЛОСЫ — плавное смешивание через alpha
  if (config.stripes.enabled && config.stripes.strength > 0) {
    const stripesOut = new Uint8ClampedArray(src.length);
    stripesOut.set(src);
    applyStripesMode(src, stripesOut, width, height, config.stripes.size, config.stripes.strength, seed + 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const di = idx * 4;
        const alpha = mask[idx] / 255;
        out[di] = out[di] * (1 - alpha) + stripesOut[di] * alpha;
        out[di + 1] = out[di + 1] * (1 - alpha) + stripesOut[di + 1] * alpha;
        out[di + 2] = out[di + 2] * (1 - alpha) + stripesOut[di + 2] * alpha;
        out[di + 3] = out[di + 3] * (1 - alpha) + stripesOut[di + 3] * alpha;
      }
    }
  }

  // ГЕОМЕТРИЯ — плавное смешивание через alpha
  if (config.geometric.enabled && config.geometric.strength > 0) {
    const geoOut = new Uint8ClampedArray(src.length);
    geoOut.set(src);
    applyGeometricMode(src, geoOut, width, height, config.geometric.size, config.geometric.strength, seed + 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const di = idx * 4;
        const alpha = mask[idx] / 255;
        out[di] = out[di] * (1 - alpha) + geoOut[di] * alpha;
        out[di + 1] = out[di + 1] * (1 - alpha) + geoOut[di + 1] * alpha;
        out[di + 2] = out[di + 2] * (1 - alpha) + geoOut[di + 2] * alpha;
        out[di + 3] = out[di + 3] * (1 - alpha) + geoOut[di + 3] * alpha;
      }
    }
  }

  // ОРГАНИКА — плавное смешивание через alpha
  if (config.organic.enabled && config.organic.strength > 0) {
    const organicOut = new Uint8ClampedArray(src.length);
    organicOut.set(src);
    applyOrganicMode(src, organicOut, width, height, config.organic.size, config.organic.strength, seed + 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const di = idx * 4;
        const alpha = mask[idx] / 255;
        out[di] = out[di] * (1 - alpha) + organicOut[di] * alpha;
        out[di + 1] = out[di + 1] * (1 - alpha) + organicOut[di + 1] * alpha;
        out[di + 2] = out[di + 2] * (1 - alpha) + organicOut[di + 2] * alpha;
        out[di + 3] = out[di + 3] * (1 - alpha) + organicOut[di + 3] * alpha;
      }
    }
  }

  if (silhouetteMask && silhouetteStrength > 0) {
    applySilhouetteProtection(out, src, width, height, silhouetteMask, silhouetteStrength);
  }
  self.postMessage({ rgba: out.buffer });
};

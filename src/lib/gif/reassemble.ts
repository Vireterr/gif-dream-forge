/**
 * Reassembly with 4 DISTINCT modes + Simplex blending (FIXED)
 * - Blocks: square/rectangular mosaic
 * - Stripes: vertical slices top-to-bottom
 * - Geometric: scattered triangles/diamonds/hexagons
 * - Organic: liquid flow via Domain Warping (fixed warp amount)
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';
import { SimplexNoise } from './simplex';

// ============ PERLIN NOISE (for Domain Warping) ============
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

// ============ BLEND MAP (Simplex Noise) ============
function generateBlendMap(
  width: number,
  height: number,
  config: ReassemblyConfig,
  seed: number
): { blocks: Float32Array; stripes: Float32Array; geometric: Float32Array; organic: Float32Array } {
  const simplex = new SimplexNoise(seed);
  const smoothness = Math.max(0.1, config.blendSmoothness / 100);
  const freq = 0.005 / smoothness;

  const blocks = new Float32Array(width * height);
  const stripes = new Float32Array(width * height);
  const geometric = new Float32Array(width * height);
  const organic = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const nx = x * freq;
      const ny = y * freq;

      const n1 = (simplex.noise(nx, ny) + 1) / 2;
      const n2 = (simplex.noise(nx + 100, ny + 100) + 1) / 2;
      const n3 = (simplex.noise(nx + 200, ny + 200) + 1) / 2;
      const n4 = (simplex.noise(nx + 300, ny + 300) + 1) / 2;

      const b1 = config.blocks.enabled ? n1 * (config.blocks.strength / 100) : 0;
      const b2 = config.stripes.enabled ? n2 * (config.stripes.strength / 100) : 0;
      const b3 = config.geometric.enabled ? n3 * (config.geometric.strength / 100) : 0;
      const b4 = config.organic.enabled ? n4 * (config.organic.strength / 100) : 0;

      const total = b1 + b2 + b3 + b4;
      if (total > 0) {
        blocks[idx] = b1 / total;
        stripes[idx] = b2 / total;
        geometric[idx] = b3 / total;
        organic[idx] = b4 / total;
      }
    }
  }

  return { blocks, stripes, geometric, organic };
}

// ============ BLOCKS MODE ============
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const written = new Uint8Array(width * height);
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

        const newX = ((x0 + ox * blockSize) % width + width) % width;
        const newY = ((y0 + oy * blockSize) % height + height) % height;

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
    }
  }
  return written;
}

// ============ STRIPES MODE ============
function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(width * percent));
  const maxOffset = Math.round(k * height * 0.5);

  let x = 0;
  while (x < width) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const x1 = Math.min(width, x + thickness);
    const offset = Math.round((rand() * 2 - 1) * maxOffset);

    if (offset !== 0) {
      const w = x1 - x;
      const pixels = new Uint8ClampedArray(w * height * 4);
      for (let y = 0; y < height; y++) {
        for (let sx = x; sx < x1; sx++) {
          const si = (y * width + sx) * 4;
          const di = (y * w + (sx - x)) * 4;
          pixels[di] = src[si];
          pixels[di + 1] = src[si + 1];
          pixels[di + 2] = src[si + 2];
          pixels[di + 3] = src[si + 3];
        }
      }

      const newY = ((offset) % height + height) % height;
      for (let y = 0; y < height; y++) {
        for (let lx = 0; lx < w; lx++) {
          const dy = ((y + newY) % height + height) % height;
          const dx = x + lx;
          const di = (dy * width + dx) * 4;
          const si = (y * w + lx) * 4;
          out[di] = pixels[si];
          out[di + 1] = pixels[si + 1];
          out[di + 2] = pixels[si + 2];
          out[di + 3] = pixels[si + 3];
          written[dy * width + dx] = 1;
        }
      }
    }
    x = x1;
  }
  return written;
}

// ============ GEOMETRIC MODE ============
function isPointInTriangle(px: number, py: number, cx: number, cy: number, size: number, rotation: number): boolean {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const h = size * 1.2;
  if (ry < -h / 2 || ry > h / 2) return false;
  const halfWidth = (size / 2) * (1 - (ry + h / 2) / h);
  return Math.abs(rx) <= halfWidth;
}

function isPointInDiamond(px: number, py: number, cx: number, cy: number, size: number, rotation: number): boolean {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = px - cx;
  const dy = py - cy;
  const rx = Math.abs(dx * cos - dy * sin);
  const ry = Math.abs(dx * sin + dy * cos);
  return (rx / size + ry / size) <= 1;
}

function isPointInHexagon(px: number, py: number, cx: number, cy: number, size: number, rotation: number): boolean {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = px - cx;
  const dy = py - cy;
  const rx = Math.abs(dx * cos - dy * sin);
  const ry = Math.abs(dx * sin + dy * cos);
  return rx <= size * 0.866 && ry <= size * 0.5 && (rx * 0.5 + ry * 0.866) <= size * 0.866;
}

function applyGeometricMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const written = new Uint8Array(width * height);
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const shape of shapes) {
        let inside = false;
        if (shape.type === 1) inside = isPointInTriangle(x, y, shape.cx, shape.cy, shape.size, shape.rotation);
        else if (shape.type === 2) inside = isPointInDiamond(x, y, shape.cx, shape.cy, shape.size, shape.rotation);
        else if (shape.type === 3) inside = isPointInHexagon(x, y, shape.cx, shape.cy, shape.size, shape.rotation);

        if (inside) {
          const newX = ((x + shape.ox) % width + width) % width;
          const newY = ((y + shape.oy) % height + height) % height;
          const si = (y * width + x) * 4;
          const di = (newY * width + newX) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
          written[newY * width + newX] = 1;
          break;
        }
      }
    }
  }
  return written;
}

// ============ ORGANIC MODE (Domain Warping - FIXED) ============
function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): Uint8Array {
  const written = new Uint8Array(width * height);
  const k = strength / 100;

  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const frequency = 0.005 + (1 - percent) * 0.03;

  const perlin1 = new PerlinNoise(seed);
  const perlin2 = new PerlinNoise(seed + 12345);

  // 🔧 ИСПРАВЛЕНО: Уменьшен warpAmount с 80 до 30, чтобы не было чёрных дыр
  const warpAmount = k * 30;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n1x = perlin1.noise(x * frequency, y * frequency);
      const n1y = perlin1.noise(x * frequency + 5.2, y * frequency + 1.3);
      
      const qx = x + n1x * warpAmount;
      const qy = y + n1y * warpAmount;
      
      const n2x = perlin2.noise(qx * frequency * 0.7, qy * frequency * 0.7);
      const n2y = perlin2.noise(qx * frequency * 0.7 + 8.3, qy * frequency * 0.7 + 2.8);

      const srcX = Math.round(x + n2x * warpAmount * 0.3);
      const srcY = Math.round(y + n2y * warpAmount * 0.3);

      const sx = ((srcX % width) + width) % width;
      const sy = ((srcY % height) + height) % height;

      const si = (sy * width + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
      written[y * width + x] = 1;
    }
  }
  return written;
}

// ============ MAIN APPLY FUNCTION ============
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
  
  // Начинаем с оригинала (это наш fallback, если ни один режим не затронул пиксель)
  out.set(src);

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;

  if (!anyEnabled) {
    return out;
  }

  const blendMask = generateBlendMap(width, height, config, seed);

  // Собираем результаты каждого режима
  const results = {
    blocks: { out: new Uint8ClampedArray(src), written: new Uint8Array(width * height) },
    stripes: { out: new Uint8ClampedArray(src), written: new Uint8Array(width * height) },
    geometric: { out: new Uint8ClampedArray(src), written: new Uint8Array(width * height) },
    organic: { out: new Uint8ClampedArray(src), written: new Uint8Array(width * height) },
  };

  if (config.blocks.enabled && config.blocks.strength > 0) {
    results.blocks.written = applyBlocksMode(src, results.blocks.out, width, height, config.blocks.size, config.blocks.strength, seed);
  }
  if (config.stripes.enabled && config.stripes.strength > 0) {
    results.stripes.written = applyStripesMode(src, results.stripes.out, width, height, config.stripes.size, config.stripes.strength, seed + 1);
  }
  if (config.geometric.enabled && config.geometric.strength > 0) {
    results.geometric.written = applyGeometricMode(src, results.geometric.out, width, height, config.geometric.size, config.geometric.strength, seed + 2);
  }
  if (config.organic.enabled && config.organic.strength > 0) {
    results.organic.written = applyOrganicMode(src, results.organic.out, width, height, config.organic.size, config.organic.strength, seed + 3);
  }

  // 🔧 ГЛАВНОЕ ИСПРАВЛЕНИЕ: Смешиваем ТОЛЬКО если режим реально записал пиксель в эту координату
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const di = idx * 4;

      const blockWeight = blendMask.blocks[idx];
      const stripeWeight = blendMask.stripes[idx];
      const geoWeight = blendMask.geometric[idx];
      const organicWeight = blendMask.organic[idx];

      let r = 0, g = 0, b = 0, a = 0;
      let totalWeight = 0;

      if (results.blocks.written[idx] && blockWeight > 0.01) {
        r += results.blocks.out[di] * blockWeight;
        g += results.blocks.out[di + 1] * blockWeight;
        b += results.blocks.out[di + 2] * blockWeight;
        a += results.blocks.out[di + 3] * blockWeight;
        totalWeight += blockWeight;
      }
      if (results.stripes.written[idx] && stripeWeight > 0.01) {
        r += results.stripes.out[di] * stripeWeight;
        g += results.stripes.out[di + 1] * stripeWeight;
        b += results.stripes.out[di + 2] * stripeWeight;
        a += results.stripes.out[di + 3] * stripeWeight;
        totalWeight += stripeWeight;
      }
      if (results.geometric.written[idx] && geoWeight > 0.01) {
        r += results.geometric.out[di] * geoWeight;
        g += results.geometric.out[di + 1] * geoWeight;
        b += results.geometric.out[di + 2] * geoWeight;
        a += results.geometric.out[di + 3] * geoWeight;
        totalWeight += geoWeight;
      }
      if (results.organic.written[idx] && organicWeight > 0.01) {
        r += results.organic.out[di] * organicWeight;
        g += results.organic.out[di + 1] * organicWeight;
        b += results.organic.out[di + 2] * organicWeight;
        a += results.organic.out[di + 3] * organicWeight;
        totalWeight += organicWeight;
      }

      // Если хотя бы один режим обработал этот пиксель, записываем смешанный результат
      if (totalWeight > 0) {
        out[di] = Math.round(r / totalWeight);
        out[di + 1] = Math.round(g / totalWeight);
        out[di + 2] = Math.round(b / totalWeight);
        out[di + 3] = Math.round(a / totalWeight);
      }
      // ИНАЧЕ: оставляем оригинальный пиксель (out уже инициализирован как src). 
      // Это гарантирует отсутствие чёрных дыр!
    }
  }

  return out;
}

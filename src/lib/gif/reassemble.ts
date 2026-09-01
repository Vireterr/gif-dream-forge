/**
 * Reassembly with 4 modes and liquid blending:
 * - blocks: square blocks
 * - stripes: horizontal/vertical slices
 * - geometric: triangles, diamonds, hexagons
 * - organic: blob-like organic shapes
 * 
 * Modes are blended using Perlin noise mask for smooth transitions.
 */

import type { Frame, ReassemblyMap, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';

// ============ PERLIN NOISE FOR BLENDING ============
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

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
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

// ============ BLEND MASK GENERATION ============
function generateBlendMask(
  width: number,
  height: number,
  config: ReassemblyConfig,
  seed: number
): { blocks: Float32Array; stripes: Float32Array; geometric: Float32Array; organic: Float32Array } {
  const perlin = new PerlinNoise(seed);
  const smoothness = Math.max(0.01, config.blendSmoothness / 100);
  const frequency = 0.005 / smoothness;

  const blocks = new Float32Array(width * height);
  const stripes = new Float32Array(width * height);
  const geometric = new Float32Array(width * height);
  const organic = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const nx = x * frequency;
      const ny = y * frequency;

      // Generate 4 noise layers (one per mode)
      const n1 = (perlin.noise(nx, ny) + 1) / 2; // 0-1
      const n2 = (perlin.noise(nx + 100, ny + 100) + 1) / 2;
      const n3 = (perlin.noise(nx + 200, ny + 200) + 1) / 2;
      const n4 = (perlin.noise(nx + 300, ny + 300) + 1) / 2;

      // Apply enabled state and strength
      const b1 = config.blocks.enabled ? n1 * (config.blocks.strength / 100) : 0;
      const b2 = config.stripes.enabled ? n2 * (config.stripes.strength / 100) : 0;
      const b3 = config.geometric.enabled ? n3 * (config.geometric.strength / 100) : 0;
      const b4 = config.organic.enabled ? n4 * (config.organic.strength / 100) : 0;

      // Normalize so sum = 1 (if any enabled)
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

// ============ FILL EMPTY SPACES ============
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
    rgba[di] = rgba[si];
    rgba[di + 1] = rgba[si + 1];
    rgba[di + 2] = rgba[si + 2];
    rgba[di + 3] = rgba[si + 3];

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

// ============ BLOCKS MODE ============
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

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

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            cleared[y * width + x] = 1;
          }
        }
      }
    }
  }

  return { cleared, written };
}

// ============ STRIPES MODE ============
function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  const isHorizontal = rand() > 0.5;
  const baseDim = isHorizontal ? height : width;
  const sliceSize = Math.max(2, Math.round(baseDim * (blockSize / 100) * 0.3));
  const maxOffset = Math.round(k * baseDim * 0.4);

  const slices: number[] = [];
  let pos = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(sliceSize * (0.5 + rand())));
    slices.push(pos);
    pos += thickness;
  }

  for (let i = 0; i < slices.length; i++) {
    const sliceStart = slices[i];
    const sliceEnd = i + 1 < slices.length ? slices[i + 1] : baseDim;
    const offset = Math.round((rand() * 2 - 1) * maxOffset);

    if (offset === 0) continue;

    let x0: number, y0: number, x1: number, y1: number;
    if (isHorizontal) {
      x0 = 0; x1 = width;
      y0 = sliceStart; y1 = sliceEnd;
    } else {
      y0 = 0; y1 = height;
      x0 = sliceStart; x1 = sliceEnd;
    }

    const w = x1 - x0;
    const h = y1 - y0;
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

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        cleared[y * width + x] = 1;
      }
    }

    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const dx = ((x0 + lx + (isHorizontal ? offset : 0)) % width + width) % width;
        const dy = ((y0 + ly + (isHorizontal ? 0 : offset)) % height + height) % height;
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

  return { cleared, written };
}

// ============ GEOMETRIC MODE ============
function isPointInTriangle(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const h = size;
  const w = size;
  const x = px - cx;
  const y = py - cy;
  if (y < -h / 2 || y > h / 2) return false;
  const halfWidth = (w / 2) * (1 - (y + h / 2) / h);
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
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  const baseSize = Math.max(10, Math.round(Math.min(width, height) * (blockSize / 100) * 0.5));
  const gridStep = baseSize;
  const maxMove = Math.round(k * baseSize * 1.5);

  interface Shape { cx: number; cy: number; size: number; type: number; ox: number; oy: number }
  const shapes: Shape[] = [];

  for (let y = 0; y < height; y += gridStep) {
    for (let x = 0; x < width; x += gridStep) {
      const cx = x + gridStep / 2 + (rand() - 0.5) * gridStep * 0.3;
      const cy = y + gridStep / 2 + (rand() - 0.5) * gridStep * 0.3;
      const size = baseSize * (0.7 + rand() * 0.6);
      const types = [1, 2, 3]; // triangle, diamond, hexagon
      const type = types[Math.floor(rand() * 3)];
      const angle = rand() * Math.PI * 2;
      const dist = (0.3 + rand() * 0.7) * maxMove;

      shapes.push({
        cx, cy, size, type,
        ox: Math.round(Math.cos(angle) * dist),
        oy: Math.round(Math.sin(angle) * dist),
      });
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const shape of shapes) {
        let inside = false;
        if (shape.type === 1) inside = isPointInTriangle(x, y, shape.cx, shape.cy, shape.size);
        else if (shape.type === 2) inside = isPointInDiamond(x, y, shape.cx, shape.cy, shape.size);
        else if (shape.type === 3) inside = isPointInHexagon(x, y, shape.cx, shape.cy, shape.size);

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
          cleared[y * width + x] = 1;
          break;
        }
      }
    }
  }

  return { cleared, written };
}

// ============ ORGANIC MODE ============
function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  const baseSize = Math.max(10, Math.round(Math.min(width, height) * (blockSize / 100) * 0.5));
  const gridStep = baseSize;
  const maxMove = Math.round(k * baseSize * 1.5);

  interface Blob { cx: number; cy: number; radius: number; ox: number; oy: number }
  const blobs: Blob[] = [];

  for (let y = 0; y < height; y += gridStep) {
    for (let x = 0; x < width; x += gridStep) {
      const cx = x + gridStep / 2 + (rand() - 0.5) * gridStep * 0.5;
      const cy = y + gridStep / 2 + (rand() - 0.5) * gridStep * 0.5;
      const radius = baseSize * (0.5 + rand() * 0.5);
      const angle = rand() * Math.PI * 2;
      const dist = (0.3 + rand() * 0.7) * maxMove;

      blobs.push({
        cx, cy, radius,
        ox: Math.round(Math.cos(angle) * dist),
        oy: Math.round(Math.sin(angle) * dist),
      });
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nearestBlob = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const dx = x - blob.cx;
        const dy = y - blob.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < blob.radius && dist < nearestDist) {
          nearestDist = dist;
          nearestBlob = i;
        }
      }

      if (nearestBlob >= 0) {
        const blob = blobs[nearestBlob];
        const newX = ((x + blob.ox) % width + width) % width;
        const newY = ((y + blob.oy) % height + height) % height;
        const si = (y * width + x) * 4;
        const di = (newY * width + newX) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
        written[newY * width + newX] = 1;
        cleared[y * width + x] = 1;
      }
    }
  }

  return { cleared, written };
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

  // Check if any mode is enabled
  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;

  if (!anyEnabled) {
    return new Uint8ClampedArray(src);
  }

  // Generate blend mask
  const blendMask = generateBlendMask(width, height, config, seed);

  // Apply each mode and collect results
  const modeResults: Array<{ out: Uint8ClampedArray; cleared: Uint8Array; written: Uint8Array }> = [];

  if (config.blocks.enabled && config.blocks.strength > 0) {
    const blocksOut = new Uint8ClampedArray(src.length);
    blocksOut.set(src);
    const { cleared, written } = applyBlocksMode(src, blocksOut, width, height, blockSize, config.blocks.strength, seed);
    modeResults.push({ out: blocksOut, cleared, written });
  }

  if (config.stripes.enabled && config.stripes.strength > 0) {
    const stripesOut = new Uint8ClampedArray(src.length);
    stripesOut.set(src);
    const { cleared, written } = applyStripesMode(src, stripesOut, width, height, blockSize, config.stripes.strength, seed + 1);
    modeResults.push({ out: stripesOut, cleared, written });
  }

  if (config.geometric.enabled && config.geometric.strength > 0) {
    const geoOut = new Uint8ClampedArray(src.length);
    geoOut.set(src);
    const { cleared, written } = applyGeometricMode(src, geoOut, width, height, blockSize, config.geometric.strength, seed + 2);
    modeResults.push({ out: geoOut, cleared, written });
  }

  if (config.organic.enabled && config.organic.strength > 0) {
    const organicOut = new Uint8ClampedArray(src.length);
    organicOut.set(src);
    const { cleared, written } = applyOrganicMode(src, organicOut, width, height, blockSize, config.organic.strength, seed + 3);
    modeResults.push({ out: organicOut, cleared, written });
  }

  // Blend results using mask
  const finalCleared = new Uint8Array(width * height);
  const finalWritten = new Uint8Array(width * height);

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

      // Blend from each mode
      if (modeResults[0] && blockWeight > 0) {
        const si = di;
        r += modeResults[0].out[si] * blockWeight;
        g += modeResults[0].out[si + 1] * blockWeight;
        b += modeResults[0].out[si + 2] * blockWeight;
        a += modeResults[0].out[si + 3] * blockWeight;
        totalWeight += blockWeight;
        if (modeResults[0].written[idx]) finalWritten[idx] = 1;
        if (modeResults[0].cleared[idx]) finalCleared[idx] = 1;
      }

      if (modeResults[1] && stripeWeight > 0) {
        const si = di;
        r += modeResults[1].out[si] * stripeWeight;
        g += modeResults[1].out[si + 1] * stripeWeight;
        b += modeResults[1].out[si + 2] * stripeWeight;
        a += modeResults[1].out[si + 3] * stripeWeight;
        totalWeight += stripeWeight;
        if (modeResults[1].written[idx]) finalWritten[idx] = 1;
        if (modeResults[1].cleared[idx]) finalCleared[idx] = 1;
      }

      if (modeResults[2] && geoWeight > 0) {
        const si = di;
        r += modeResults[2].out[si] * geoWeight;
        g += modeResults[2].out[si + 1] * geoWeight;
        b += modeResults[2].out[si + 2] * geoWeight;
        a += modeResults[2].out[si + 3] * geoWeight;
        totalWeight += geoWeight;
        if (modeResults[2].written[idx]) finalWritten[idx] = 1;
        if (modeResults[2].cleared[idx]) finalCleared[idx] = 1;
      }

      if (modeResults[3] && organicWeight > 0) {
        const si = di;
        r += modeResults[3].out[si] * organicWeight;
        g += modeResults[3].out[si + 1] * organicWeight;
        b += modeResults[3].out[si + 2] * organicWeight;
        a += modeResults[3].out[si + 3] * organicWeight;
        totalWeight += organicWeight;
        if (modeResults[3].written[idx]) finalWritten[idx] = 1;
        if (modeResults[3].cleared[idx]) finalCleared[idx] = 1;
      }

      // If no mode affected this pixel, use original
      if (totalWeight === 0) {
        out[di] = src[di];
        out[di + 1] = src[di + 1];
        out[di + 2] = src[di + 2];
        out[di + 3] = src[di + 3];
      } else {
        out[di] = Math.round(r / totalWeight);
        out[di + 1] = Math.round(g / totalWeight);
        out[di + 2] = Math.round(b / totalWeight);
        out[di + 3] = Math.round(a / totalWeight);
      }
    }
  }

  // Fill empty spaces
  const isEmpty = (i: number) => finalCleared[i] === 1 && finalWritten[i] === 0;
  fillEmptySpacesWithStretch(out, width, height, isEmpty);

  return out;
}

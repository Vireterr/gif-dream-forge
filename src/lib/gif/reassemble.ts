/**
 * Reassembly with 4 DISTINCT modes + Simplex blending:
 * - Blocks: square/rectangular mosaic (White Noise for direction)
 * - Stripes: vertical slices top-to-bottom (deterministic)
 * - Geometric: scattered triangles/diamonds/hexagons (White Noise)
 * - Organic: liquid flow via Domain Warping
 * 
 * Blending between modes uses Simplex Noise.
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

      // 4 independent simplex layers
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
// Square/rectangular mosaic, each block moves as whole unit
function applyBlocksMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  // Block size based on sizePercent (5-80% of min dimension)
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      // White Noise: random direction per block
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

        // Copy block pixels
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

        // Place at new position (wrap around)
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
// Vertical slices from top to bottom, deterministic
function applyStripesMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  // Stripe width based on sizePercent
  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(width * percent));
  const maxOffset = Math.round(k * height * 0.5);

  // Generate vertical stripes across entire image
  let x = 0;
  while (x < width) {
    // Random thickness variation (70% to 130% of base)
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const x1 = Math.min(width, x + thickness);

    // Vertical offset for this stripe
    const offset = Math.round((rand() * 2 - 1) * maxOffset);

    if (offset !== 0) {
      // Copy stripe pixels
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

      // Place at new Y position (wrap vertically)
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

      for (let y = 0; y < height; y++) {
        for (let sx = x; sx < x1; sx++) {
          cleared[y * width + sx] = 1;
        }
      }
    }

    x = x1;
  }

  return { cleared, written };
}

// ============ GEOMETRIC MODE ============
// Scattered triangles/diamonds/hexagons with overlap
function isPointInTriangle(px: number, py: number, cx: number, cy: number, size: number, rotation: number): boolean {
  // Rotate point around center
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  // Equilateral triangle
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
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const rand = mulberry32(seed);
  const k = strength / 100;

  // Shape size based on sizePercent
  const percent = Math.max(3, Math.min(40, sizePercent)) / 100;
  const baseSize = Math.max(8, Math.round(Math.min(width, height) * percent));
  const maxMove = Math.round(k * baseSize * 1.5);

  // Generate scattered shapes (not grid-based!)
  const numShapes = Math.max(5, Math.round((width * height) / (baseSize * baseSize) * 0.5));
  
  interface Shape { cx: number; cy: number; size: number; type: number; rotation: number; ox: number; oy: number }
  const shapes: Shape[] = [];

  for (let i = 0; i < numShapes; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const size = baseSize * (0.6 + rand() * 0.8);
    const types = [1, 2, 3]; // triangle, diamond, hexagon
    const type = types[Math.floor(rand() * 3)];
    const rotation = rand() * Math.PI * 2;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;

    shapes.push({
      cx, cy, size, type, rotation,
      ox: Math.round(Math.cos(angle) * dist),
      oy: Math.round(Math.sin(angle) * dist),
    });
  }

  // For each pixel, find which shape it belongs to (first match wins for overlap)
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
          cleared[y * width + x] = 1;
          break;
        }
      }
    }
  }

  return { cleared, written };
}

// ============ ORGANIC MODE (Domain Warping) ============
// Liquid flow using Domain Warping technique
function applyOrganicMode(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  sizePercent: number,
  strength: number,
  seed: number
): { cleared: Uint8Array; written: Uint8Array } {
  const cleared = new Uint8Array(width * height);
  const written = new Uint8Array(width * height);
  const k = strength / 100;

  // Frequency based on sizePercent (lower = larger "drops")
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const frequency = 0.005 + (1 - percent) * 0.03;

  // Two Perlin noises for domain warping
  const perlin1 = new PerlinNoise(seed);
  const perlin2 = new PerlinNoise(seed + 12345);

  // Warp amount based on strength
  const warpAmount = k * 80;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Domain warping: distort coordinates through noise
      const n1x = perlin1.noise(x * frequency, y * frequency);
      const n1y = perlin1.noise(x * frequency + 5.2, y * frequency + 1.3);
      
      // Second level of warping for more organic feel
      const qx = x + n1x * warpAmount;
      const qy = y + n1y * warpAmount;
      
      const n2x = perlin2.noise(qx * frequency * 0.7, qy * frequency * 0.7);
      const n2y = perlin2.noise(qx * frequency * 0.7 + 8.3, qy * frequency * 0.7 + 2.8);

      // Final warped source coordinates
      const srcX = Math.round(x + n2x * warpAmount * 0.5);
      const srcY = Math.round(y + n2y * warpAmount * 0.5);

      // Wrap around
      const sx = ((srcX % width) + width) % width;
      const sy = ((srcY % height) + height) % height;

      const si = (sy * width + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
      written[y * width + x] = 1;
      cleared[y * width + x] = 1;
    }
  }

  return { cleared, written };
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

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;

  if (!anyEnabled) {
    return new Uint8ClampedArray(src);
  }

  // Generate blend map (Simplex Noise)
  const blendMask = generateBlendMap(width, height, config, seed);

  // Apply each mode and collect results
  const modeResults: Array<{ out: Uint8ClampedArray; cleared: Uint8Array; written: Uint8Array }> = [];

  if (config.blocks.enabled && config.blocks.strength > 0) {
    const blocksOut = new Uint8ClampedArray(src.length);
    blocksOut.set(src);
    const { cleared, written } = applyBlocksMode(
      src, blocksOut, width, height,
      config.blocks.size, config.blocks.strength, seed
    );
    modeResults.push({ out: blocksOut, cleared, written });
  } else {
    modeResults.push({ out: new Uint8ClampedArray(src), cleared: new Uint8Array(width * height), written: new Uint8Array(width * height) });
  }

  if (config.stripes.enabled && config.stripes.strength > 0) {
    const stripesOut = new Uint8ClampedArray(src.length);
    stripesOut.set(src);
    const { cleared, written } = applyStripesMode(
      src, stripesOut, width, height,
      config.stripes.size, config.stripes.strength, seed + 1
    );
    modeResults.push({ out: stripesOut, cleared, written });
  } else {
    modeResults.push({ out: new Uint8ClampedArray(src), cleared: new Uint8Array(width * height), written: new Uint8Array(width * height) });
  }

  if (config.geometric.enabled && config.geometric.strength > 0) {
    const geoOut = new Uint8ClampedArray(src.length);
    geoOut.set(src);
    const { cleared, written } = applyGeometricMode(
      src, geoOut, width, height,
      config.geometric.size, config.geometric.strength, seed + 2
    );
    modeResults.push({ out: geoOut, cleared, written });
  } else {
    modeResults.push({ out: new Uint8ClampedArray(src), cleared: new Uint8Array(width * height), written: new Uint8Array(width * height) });
  }

  if (config.organic.enabled && config.organic.strength > 0) {
    const organicOut = new Uint8ClampedArray(src.length);
    organicOut.set(src);
    const { cleared, written } = applyOrganicMode(
      src, organicOut, width, height,
      config.organic.size, config.organic.strength, seed + 3
    );
    modeResults.push({ out: organicOut, cleared, written });
  } else {
    modeResults.push({ out: new Uint8ClampedArray(src), cleared: new Uint8Array(width * height), written: new Uint8Array(width * height) });
  }

  // Blend results using Simplex mask
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

      // Blocks
      if (blockWeight > 0.01) {
        const si = di;
        r += modeResults[0].out[si] * blockWeight;
        g += modeResults[0].out[si + 1] * blockWeight;
        b += modeResults[0].out[si + 2] * blockWeight;
        a += modeResults[0].out[si + 3] * blockWeight;
        totalWeight += blockWeight;
      }

      // Stripes
      if (stripeWeight > 0.01) {
        const si = di;
        r += modeResults[1].out[si] * stripeWeight;
        g += modeResults[1].out[si + 1] * stripeWeight;
        b += modeResults[1].out[si + 2] * stripeWeight;
        a += modeResults[1].out[si + 3] * stripeWeight;
        totalWeight += stripeWeight;
      }

      // Geometric
      if (geoWeight > 0.01) {
        const si = di;
        r += modeResults[2].out[si] * geoWeight;
        g += modeResults[2].out[si + 1] * geoWeight;
        b += modeResults[2].out[si + 2] * geoWeight;
        a += modeResults[2].out[si + 3] * geoWeight;
        totalWeight += geoWeight;
      }

      // Organic
      if (organicWeight > 0.01) {
        const si = di;
        r += modeResults[3].out[si] * organicWeight;
        g += modeResults[3].out[si + 1] * organicWeight;
        b += modeResults[3].out[si + 2] * organicWeight;
        a += modeResults[3].out[si + 3] * organicWeight;
        totalWeight += organicWeight;
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

  return out;
}

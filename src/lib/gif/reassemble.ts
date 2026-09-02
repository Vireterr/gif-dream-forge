/**
 * Reassembly: Clean modes + Mask as separate element
 * - Mask: Simplex Noise zones (determines WHERE, not HOW)
 * - Blocks: pure square mosaic (no distortion)
 * - Stripes: pure horizontal/vertical slices (no distortion)
 * - Geometric: pure triangles/diamonds/hexagons (no distortion)
 * - Organic: pure Voronoi cells (no distortion)
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';
import { SimplexNoise } from './simplex';

// ============ MASK (Simplex Noise zones) ============
function generateMask(
  width: number,
  height: number,
  config: ReassemblyConfig,
  seed: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  if (!config.mask.enabled || config.mask.strength === 0) {
    // Если маска выключена — все пиксели = 1 (режимы применяются ко всему)
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
      const n = (simplex.noise(nx, ny) + 1) / 2; // 0-1
      mask[y * width + x] = Math.round(n * 255 * strength);
    }
  }

  return mask;
}

// ============ BLOCKS MODE (PURE - no distortion) ============
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
          }
        }
      }
    }
  }
}

// ============ STRIPES MODE (PURE - no distortion) ============
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
            const newX = ((x + offset) % width + width) % width;
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
            const newY = ((y + offset) % height + height) % height;
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

// ============ GEOMETRIC MODE (PURE - no distortion) ============
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

    shapes.push({
      cx, cy, size, type, rotation,
      ox: Math.round(Math.cos(angle) * dist),
      oy: Math.round(Math.sin(angle) * dist),
    });
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
    if (s.type === 2) {
      return (rx / s.size + ry / s.size) <= 1;
    }
    if (s.type === 3) {
      return rx <= s.size * 0.866 && ry <= s.size * 0.5 && (rx * 0.5 + ry * 0.866) <= s.size * 0.866;
    }
    return false;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const s of shapes) {
        if (isInside(x, y, s)) {
          const newX = ((x + s.ox) % width + width) % width;
          const newY = ((y + s.oy) % height + height) % height;
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

// ============ ORGANIC MODE (PURE Voronoi - no distortion) ============
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
    vcells.push({
      cx, cy,
      ox: Math.round(Math.cos(angle) * dist),
      oy: Math.round(Math.sin(angle) * dist),
    });
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
      const newX = ((x + cell.ox) % width + width) % width;
      const newY = ((y + cell.oy) % height + height) % height;
      const si = (y * width + x) * 4;
      const di = (newY * width + newX) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
}

// ============ SILHOUETTE PROTECTION ============
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

// ============ MAIN APPLY FUNCTION ============
export function applyReassemblyToFrame(
  frame: Frame,
  _blockSize: number,
  config: ReassemblyConfig,
  seed: number,
  silhouetteMask?: Uint8Array,
  silhouetteStrength = 0
): Uint8ClampedArray {
  const { rgba: src, width, height } = frame;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;

  if (!anyEnabled) {
    return out;
  }

  // Generate mask (determines WHERE modes apply)
  const mask = generateMask(width, height, config, seed);

  // Apply each mode to pixels where mask > threshold
  const threshold = 128; // Pixels with mask value > 128 get processed

  if (config.blocks.enabled && config.blocks.strength > 0) {
    const blocksOut = new Uint8ClampedArray(src.length);
    blocksOut.set(src);
    applyBlocksMode(src, blocksOut, width, height, config.blocks.size, config.blocks.strength, seed);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] > threshold) {
          const di = idx * 4;
          out[di] = blocksOut[di];
          out[di + 1] = blocksOut[di + 1];
          out[di + 2] = blocksOut[di + 2];
          out[di + 3] = blocksOut[di + 3];
        }
      }
    }
  }

  if (config.stripes.enabled && config.stripes.strength > 0) {
    const stripesOut = new Uint8ClampedArray(src.length);
    stripesOut.set(src);
    applyStripesMode(src, stripesOut, width, height, config.stripes.size, config.stripes.strength, seed + 1);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] > threshold) {
          const di = idx * 4;
          out[di] = stripesOut[di];
          out[di + 1] = stripesOut[di + 1];
          out[di + 2] = stripesOut[di + 2];
          out[di + 3] = stripesOut[di + 3];
        }
      }
    }
  }

  if (config.geometric.enabled && config.geometric.strength > 0) {
    const geoOut = new Uint8ClampedArray(src.length);
    geoOut.set(src);
    applyGeometricMode(src, geoOut, width, height, config.geometric.size, config.geometric.strength, seed + 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] > threshold) {
          const di = idx * 4;
          out[di] = geoOut[di];
          out[di + 1] = geoOut[di + 1];
          out[di + 2] = geoOut[di + 2];
          out[di + 3] = geoOut[di + 3];
        }
      }
    }
  }

  if (config.organic.enabled && config.organic.strength > 0) {
    const organicOut = new Uint8ClampedArray(src.length);
    organicOut.set(src);
    applyOrganicMode(src, organicOut, width, height, config.organic.size, config.organic.strength, seed + 3);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] > threshold) {
          const di = idx * 4;
          out[di] = organicOut[di];
          out[di + 1] = organicOut[di + 1];
          out[di + 2] = organicOut[di + 2];
          out[di + 3] = organicOut[di + 3];
        }
      }
    }
  }

  // Silhouette protection
  if (silhouetteMask && silhouetteStrength > 0) {
    applySilhouetteProtection(out, src, width, height, silhouetteMask, silhouetteStrength);
  }

  return out;
}

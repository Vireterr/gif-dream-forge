/**
 * Reassembly with TRUE backward mapping — no ghosting, no stains.
 * For each output pixel, we find where it should come FROM in the source.
 */

import type { Frame, ReassemblyConfig } from './types';
import { mulberry32 } from '../utils/noise';
import { SimplexNoise } from './simplex';

// ============ VORONOI BLENDING ============
interface VoronoiCell {
  x: number;
  y: number;
  mode: 'blocks' | 'stripes' | 'geometric' | 'organic';
  seed: number;
}

function generateVoronoiCells(
  width: number,
  height: number,
  config: ReassemblyConfig,
  seed: number
): VoronoiCell[] {
  const rand = mulberry32(seed);
  const cells: VoronoiCell[] = [];

  const baseCellSize = Math.max(50, Math.min(width, height) * (0.15 + (1 - config.blendSmoothness / 100) * 0.3));
  const numCells = Math.round((width * height) / (baseCellSize * baseCellSize));

  const enabledModes: Array<{ mode: 'blocks' | 'stripes' | 'geometric' | 'organic'; weight: number }> = [];
  if (config.blocks.enabled && config.blocks.strength > 0) {
    enabledModes.push({ mode: 'blocks', weight: config.blocks.strength });
  }
  if (config.stripes.enabled && config.stripes.strength > 0) {
    enabledModes.push({ mode: 'stripes', weight: config.stripes.strength });
  }
  if (config.geometric.enabled && config.geometric.strength > 0) {
    enabledModes.push({ mode: 'geometric', weight: config.geometric.strength });
  }
  if (config.organic.enabled && config.organic.strength > 0) {
    enabledModes.push({ mode: 'organic', weight: config.organic.strength });
  }

  if (enabledModes.length === 0) return [];

  const totalWeight = enabledModes.reduce((s, m) => s + m.weight, 0);

  for (const em of enabledModes) {
    const count = Math.max(1, Math.round(numCells * (em.weight / totalWeight)));
    for (let i = 0; i < count; i++) {
      cells.push({
        x: rand() * width,
        y: rand() * height,
        mode: em.mode,
        seed: Math.floor(rand() * 1e9),
      });
    }
  }

  return cells;
}

function findDominantCell(
  x: number, y: number,
  cells: VoronoiCell[],
  simplex: SimplexNoise,
  distortionStrength: number
): VoronoiCell | null {
  if (cells.length === 0) return null;

  let nearest: VoronoiCell | null = null;
  let nearestDist = Infinity;

  const distFreq = 0.008;
  const distX = simplex.noise(x * distFreq, y * distFreq) * distortionStrength;
  const distY = simplex.noise(x * distFreq + 100, y * distFreq + 100) * distortionStrength;

  const distortedX = x + distX;
  const distortedY = y + distY;

  for (const cell of cells) {
    const dx = distortedX - cell.x;
    const dy = distortedY - cell.y;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = cell;
    }
  }

  return nearest;
}

// ============ PRECOMPUTE MODE OFFSETS ============
// For backward mapping, we need to know: for each block/stripe/cell, what's its offset?

interface BlockInfo {
  bx: number; by: number;
  ox: number; oy: number;
  blockSize: number;
}

interface StripeInfo {
  idx: number;
  isHorizontal: boolean;
  offset: number;
  stripeWidth: number;
}

interface VoronoiOrganicCell {
  cx: number; cy: number;
  ox: number; oy: number;
}

function precomputeBlocks(
  width: number, height: number,
  sizePercent: number, strength: number,
  seed: number
): BlockInfo[] {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const blockSize = Math.max(4, Math.round(Math.min(width, height) * percent));
  const cols = Math.max(1, Math.ceil(width / blockSize));
  const rows = Math.max(1, Math.ceil(height / blockSize));
  const maxMove = Math.max(1, Math.round(k * Math.max(cols, rows) * 0.8));

  const blocks: BlockInfo[] = [];
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      if (rand() < 0.7 + k * 0.3) {
        const angle = rand() * Math.PI * 2;
        const dist = (0.3 + rand() * 0.7) * maxMove;
        blocks.push({
          bx, by,
          ox: Math.round(Math.cos(angle) * dist),
          oy: Math.round(Math.sin(angle) * dist),
          blockSize,
        });
      }
    }
  }
  return blocks;
}

function precomputeStripes(
  width: number, height: number,
  sizePercent: number, strength: number,
  seed: number
): { isHorizontal: boolean; stripes: StripeInfo[] } {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(2, Math.min(50, sizePercent)) / 100;
  const stripeWidth = Math.max(2, Math.round(Math.min(width, height) * percent));
  const maxOffset = Math.round(k * Math.max(width, height) * 0.5);

  const isHorizontal = rand() > 0.5;
  const baseDim = isHorizontal ? height : width;

  const stripes: StripeInfo[] = [];
  let pos = 0;
  let idx = 0;
  while (pos < baseDim) {
    const thickness = Math.max(1, Math.round(stripeWidth * (0.7 + rand() * 0.6)));
    const offset = Math.round((rand() * 2 - 1) * maxOffset);
    stripes.push({ idx, isHorizontal, offset, stripeWidth: thickness });
    pos += thickness;
    idx++;
  }
  return { isHorizontal, stripes };
}

function precomputeOrganicCells(
  width: number, height: number,
  sizePercent: number, strength: number,
  seed: number
): VoronoiOrganicCell[] {
  const rand = mulberry32(seed);
  const k = strength / 100;
  const percent = Math.max(5, Math.min(80, sizePercent)) / 100;
  const baseCellSize = Math.max(10, Math.round(Math.min(width, height) * percent));
  const numCells = Math.max(3, Math.round((width * height) / (baseCellSize * baseCellSize) * 0.7));
  const maxMove = Math.round(k * baseCellSize * 1.5);

  const cells: VoronoiOrganicCell[] = [];
  for (let i = 0; i < numCells; i++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const angle = rand() * Math.PI * 2;
    const dist = (0.3 + rand() * 0.7) * maxMove;
    cells.push({
      cx, cy,
      ox: Math.round(Math.cos(angle) * dist),
      oy: Math.round(Math.sin(angle) * dist),
    });
  }
  return cells;
}

// ============ MAIN APPLY FUNCTION (BACKWARD MAPPING) ============
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

  const anyEnabled = config.blocks.enabled || config.stripes.enabled || 
                     config.geometric.enabled || config.organic.enabled;

  if (!anyEnabled) {
    out.set(src);
    return out;
  }

  // Generate Voronoi cells for mode blending
  const cells = generateVoronoiCells(width, height, config, seed);
  const simplex = new SimplexNoise(seed);
  const distortionStrength = 50 + config.blendSmoothness * 2;

  // Precompute all mode data (offsets for each block/stripe/cell)
  const blocksData = config.blocks.enabled && config.blocks.strength > 0
    ? precomputeBlocks(width, height, config.blocks.size, config.blocks.strength, seed)
    : [];
  const stripesData = config.stripes.enabled && config.stripes.strength > 0
    ? precomputeStripes(width, height, config.stripes.size, config.stripes.strength, seed + 1)
    : null;
  const organicCells = config.organic.enabled && config.organic.strength > 0
    ? precomputeOrganicCells(width, height, config.organic.size, config.organic.strength, seed + 3)
    : [];

  // Geometric: use simplex for per-pixel displacement
  const geoK = config.geometric.enabled ? config.geometric.strength / 100 : 0;
  const geoPercent = config.geometric.enabled ? Math.max(3, Math.min(40, config.geometric.size)) / 100 : 0;
  const geoBaseSize = Math.max(8, Math.round(Math.min(width, height) * geoPercent));
  const geoMaxMove = Math.round(geoK * geoBaseSize * 1.5);

  // 🔧 BACKWARD MAPPING: for each output pixel, find where to sample from source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const di = idx * 4;

      // Find which mode zone this pixel belongs to
      const cell = findDominantCell(x, y, cells, simplex, distortionStrength);
      
      let srcX = x;
      let srcY = y;

      if (cell) {
        switch (cell.mode) {
          case 'blocks': {
            // Find which block this pixel is in, then invert its offset
            const blockSize = blocksData[0]?.blockSize || 30;
            const bx = Math.floor(x / blockSize);
            const by = Math.floor(y / blockSize);
            const block = blocksData.find(b => b.bx === bx && b.by === by);
            if (block) {
              // Invert: if block moved by (ox, oy), sample from (x - ox, y - oy)
              srcX = x - block.ox * blockSize;
              srcY = y - block.oy * blockSize;
            }
            break;
          }
          case 'stripes': {
            if (stripesData) {
              const { isHorizontal, stripes } = stripesData;
              if (isHorizontal) {
                const stripeIdx = Math.floor(y / stripesData.stripes[0]?.stripeWidth || 10);
                // Find stripe containing this y
                let pos = 0;
                for (const stripe of stripes) {
                  if (y >= pos && y < pos + stripe.stripeWidth) {
                    srcX = x - stripe.offset;
                    break;
                  }
                  pos += stripe.stripeWidth;
                }
              } else {
                let pos = 0;
                for (const stripe of stripes) {
                  if (x >= pos && x < pos + stripe.stripeWidth) {
                    srcY = y - stripe.offset;
                    break;
                  }
                  pos += stripe.stripeWidth;
                }
              }
            }
            break;
          }
          case 'geometric': {
            // Per-pixel displacement based on simplex
            const angle = simplex.noise(x * 0.01 + 500, y * 0.01 + 500) * Math.PI * 2;
            const dist = (0.3 + (simplex.noise(x * 0.01 + 550, y * 0.01 + 550) + 1) / 2 * 0.7) * geoMaxMove;
            srcX = x - Math.round(Math.cos(angle) * dist);
            srcY = y - Math.round(Math.sin(angle) * dist);
            break;
          }
          case 'organic': {
            // Find nearest Voronoi cell and invert its offset
            let nearestIdx = 0;
            let nearestDist = Infinity;
            for (let i = 0; i < organicCells.length; i++) {
              const dx = x - organicCells[i].cx;
              const dy = y - organicCells[i].cy;
              const dist = dx * dx + dy * dy;
              if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = i;
              }
            }
            if (organicCells[nearestIdx]) {
              srcX = x - organicCells[nearestIdx].ox;
              srcY = y - organicCells[nearestIdx].oy;
            }
            break;
          }
        }
      }

      // Wrap around
      srcX = ((srcX % width) + width) % width;
      srcY = ((srcY % height) + height) % height;

      const si = (srcY * width + srcX) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }

  // Silhouette protection
  if (silhouetteMask && silhouetteStrength > 0) {
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

  return out;
}

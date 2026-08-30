/**
 * Shape / form variation: geometric and non-linear deformations.
 *
 * Produces an absolute inverse-mapping displacement field (dx, dy) that can be
 * added on top of the noise field before warping. All parameters are derived
 * deterministically from a seed, so a variation is reproducible, and the
 * deformation is frame-coherent (only a smooth sinusoidal breathing changes
 * over time) so animations do not flicker.
 */

import type { DisplacementField } from './types';
import { mulberry32 } from '../utils/noise';

export type ShapeMode = 'affine' | 'swirl' | 'ripple' | 'pinch' | 'wave' | 'shear-stretch';

export interface ShapeRecipe {
  modes: ShapeMode[];
  rotation: number;      // radians
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  offsetX: number;       // fraction of width
  offsetY: number;       // fraction of height
  mirror: boolean;
  centerX: number;       // 0..1
  centerY: number;       // 0..1
  swirlAngle: number;    // radians at center
  swirlRadius: number;   // fraction of min dimension
  rippleAmp: number;     // px
  rippleFreq: number;
  pinchAmount: number;   // -1 (pinch) .. 1 (bulge)
  waveAmpX: number;
  waveAmpY: number;
  waveFreqX: number;
  waveFreqY: number;
  breathe: number;       // temporal breathing amount 0..1
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] ?? items[0]!;
}

/**
 * Build a shape recipe.
 * @param strength 0..1 — how deep the form changes are (UI "Shape variation")
 * @param similarity 0..100 — global similarity, damps everything
 */
export function buildShapeRecipe(seed: number, strength: number, similarity: number): ShapeRecipe {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const sim = Math.max(0, Math.min(1, similarity / 100));
  // Similarity damps the form changes, but never fully cancels them when the
  // user explicitly asks for shape variation.
  const k = Math.max(0, Math.min(1, strength)) * (0.35 + 0.65 * (1 - sim));

  const all: ShapeMode[] = ['affine', 'swirl', 'ripple', 'pinch', 'wave', 'shear-stretch'];
  const modeCount = k < 0.15 ? 1 : k < 0.45 ? 2 : 3;
  const modes: ShapeMode[] = ['affine'];
  const pool = all.filter((m) => m !== 'affine');
  for (let i = 0; i < modeCount; i++) {
    const m = pick(rand, pool);
    if (!modes.includes(m)) modes.push(m);
  }

  const sgn = () => (rand() > 0.5 ? 1 : -1);

  return {
    modes,
    rotation: sgn() * rand() * k * 0.35,              // up to ~20°
    scaleX: 1 + sgn() * rand() * k * 0.35,
    scaleY: 1 + sgn() * rand() * k * 0.35,
    skewX: sgn() * rand() * k * 0.3,
    skewY: sgn() * rand() * k * 0.22,
    offsetX: sgn() * rand() * k * 0.12,
    offsetY: sgn() * rand() * k * 0.12,
    mirror: k > 0.55 && rand() > 0.75,
    centerX: 0.3 + rand() * 0.4,
    centerY: 0.3 + rand() * 0.4,
    swirlAngle: sgn() * rand() * k * 2.2,
    swirlRadius: 0.35 + rand() * 0.45,
    rippleAmp: rand() * k * 18,
    rippleFreq: 3 + rand() * 9,
    pinchAmount: sgn() * rand() * k * 0.6,
    waveAmpX: sgn() * rand() * k * 14,
    waveAmpY: sgn() * rand() * k * 14,
    waveFreqX: 1 + rand() * 4,
    waveFreqY: 1 + rand() * 4,
    breathe: rand() * k * 0.5,
  };
}

/**
 * Build the shape displacement field for a given frame.
 * Values are inverse-mapping deltas: source = (x + dx, y + dy).
 */
export function buildShapeField(
  width: number,
  height: number,
  recipe: ShapeRecipe,
  frameIndex: number,
  totalFrames: number
): DisplacementField {
  const dx = new Float32Array(width * height);
  const dy = new Float32Array(width * height);

  const phase = totalFrames > 1 ? (frameIndex / totalFrames) * Math.PI * 2 : 0;
  const breath = 1 + Math.sin(phase) * recipe.breathe * 0.25;

  const cx = recipe.centerX * width;
  const cy = recipe.centerY * height;
  const minDim = Math.min(width, height);
  const radius = recipe.swirlRadius * minDim;

  const useAffine = recipe.modes.includes('affine') || recipe.modes.includes('shear-stretch');
  const useSwirl = recipe.modes.includes('swirl');
  const useRipple = recipe.modes.includes('ripple');
  const usePinch = recipe.modes.includes('pinch');
  const useWave = recipe.modes.includes('wave');

  // Inverse affine parameters
  const sx = (recipe.mirror ? -1 : 1) * recipe.scaleX * breath;
  const sy = recipe.scaleY * breath;
  const cos = Math.cos(-recipe.rotation);
  const sin = Math.sin(-recipe.rotation);
  const shearX = recipe.modes.includes('shear-stretch') ? recipe.skewX : 0;
  const shearY = recipe.modes.includes('shear-stretch') ? recipe.skewY : 0;
  const offX = recipe.offsetX * width;
  const offY = recipe.offsetY * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px = x - cx;
      let py = y - cy;

      if (useAffine) {
        // translate back
        px -= offX;
        py -= offY;
        // inverse rotation
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        // inverse scale + shear
        px = rx / sx + ry * shearX;
        py = ry / sy + rx * shearY;
      }

      if (useSwirl || usePinch) {
        const dist = Math.hypot(px, py);
        const t = Math.max(0, 1 - dist / radius);
        if (t > 0) {
          if (useSwirl) {
            const a = recipe.swirlAngle * t * t * breath;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const nx = px * ca - py * sa;
            const ny = px * sa + py * ca;
            px = nx;
            py = ny;
          }
          if (usePinch) {
            const factor = 1 + recipe.pinchAmount * t * t;
            px *= factor;
            py *= factor;
          }
        }
      }

      let sxPos = px + cx;
      let syPos = py + cy;

      if (useRipple) {
        const dist = Math.hypot(x - cx, y - cy) / minDim;
        const r = Math.sin(dist * recipe.rippleFreq * Math.PI * 2 + phase) * recipe.rippleAmp;
        const ang = Math.atan2(y - cy, x - cx);
        sxPos += Math.cos(ang) * r;
        syPos += Math.sin(ang) * r;
      }

      if (useWave) {
        sxPos += Math.sin((y / height) * recipe.waveFreqY * Math.PI * 2 + phase) * recipe.waveAmpX;
        syPos += Math.sin((x / width) * recipe.waveFreqX * Math.PI * 2 + phase) * recipe.waveAmpY;
      }

      const idx = y * width + x;
      dx[idx] = sxPos - x;
      dy[idx] = syPos - y;
    }
  }

  return { dx, dy, width, height };
}

/** Add two displacement fields together. */
export function addFields(a: DisplacementField, b: DisplacementField): DisplacementField {
  const dx = new Float32Array(a.dx.length);
  const dy = new Float32Array(a.dy.length);
  for (let i = 0; i < dx.length; i++) {
    dx[i] = a.dx[i]! + b.dx[i]!;
    dy[i] = a.dy[i]! + b.dy[i]!;
  }
  return { dx, dy, width: a.width, height: a.height };
}
